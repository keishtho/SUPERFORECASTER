// SUPERFORECASTER - Support Capacity Planning Application
// Main application class with proper separation of concerns

class SuperForecaster {
    constructor() {
        this.state = {
            segments: {"nonvip":{"name":"Non-VIP","color":"#3498db","config":{"customers":13000,"contactRate":0.48,"aiDeflection":20,"chatDeflection":20,"handleTimeImprovement":20,"coreTeamSize":12,"tdcxTeamSize":6,"coreTicketsPerDay":15,"tdcxTicketsPerDay":10,"seasonalMultiplier":1.2}},"vip":{"name":"VIP","color":"#e74c3c","config":{"customers":10000,"contactRate":1.15,"aiDeflection":20,"chatDeflection":20,"handleTimeImprovement":20,"coreTeamSize":12,"tdcxTeamSize":0,"coreTicketsPerDay":7,"tdcxTicketsPerDay":0,"seasonalMultiplier":1.2}},"plus":{"name":"Plus","color":"#f39c12","config":{"customers":5000,"contactRate":0.08,"aiDeflection":20,"chatDeflection":20,"handleTimeImprovement":20,"coreTeamSize":4,"tdcxTeamSize":0,"coreTicketsPerDay":5,"tdcxTicketsPerDay":10,"seasonalMultiplier":1.2}}},
            months: this.generateMonths(),
            columnLocks: {},
            manualOverrides: {}
        };

        this.constants = {
            WORKING_DAYS_PER_MONTH: 22,
            OCCUPANCY_RATE: 0.85,
            MONTHS_TO_FORECAST: 25
        };

        this.init();
    }

    // Initialize the application
    init() {
        this.loadState();
        this.loadOverrides();
        this.render();
        this.bindEvents();
        this.setupCharts();
    }

    // Generate months array (6 past + current + 18 future)
    generateMonths() {
        const months = [];
        const currentDate = new Date();
        const currentMonth = currentDate.getMonth();
        const currentYear = currentDate.getFullYear();

        for (let i = -6; i < 19; i++) {
            const date = new Date(currentYear, currentMonth + i, 1);
            const monthName = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
            
            months.push({
                date: date,
                month: monthName,
                isCurrentMonth: i === 0,
                isPastMonth: i < 0,
            });
        }

        return months;
    }

    // Event binding using event delegation
    bindEvents() {
        const configContainer = document.getElementById('configContainer');
        if (configContainer) {
            configContainer.addEventListener('input', (e) => {
                if (e.target.tagName === 'INPUT') {
                    const { segment, config } = e.target.dataset;
                    if (segment && config) {
                        let value = parseFloat(e.target.value);
                        if (isNaN(value)) value = 0;

                        if (config === 'contactRate') {
                            this.state.segments[segment].config[config] = value / 100;
                        } else {
                            this.state.segments[segment].config[config] = value;
                        }

                        // Propagate default change to monthly inputs without overrides
                        this.state.months.forEach(month => {
                            const monthId = month.month;
                            const hasOverride = this.state.manualOverrides?.[segment]?.[monthId]?.[config] !== undefined;
                            const isRowLocked = this.state.manualOverrides?.[segment]?.[monthId]?.isLocked || false;
                            const isColLocked = this.isColumnLocked(segment, config);

                            if (!hasOverride && !isRowLocked && !isColLocked) {
                                const inputEl = document.querySelector(`.forecast-table input[data-segment="${segment}"][data-month="${monthId}"][data-config="${config}"]`);
                                if (inputEl) {
                                    // The value in the input is always the direct user-facing value
                                    inputEl.value = value;
                                }
                            }
                        });

                        this.updateCalculations();
                    }
                }
            });
        }
        
        const forecastContainer = document.getElementById('forecastContainer');
        if (forecastContainer) {
            forecastContainer.addEventListener('input', (e) => {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') {
                    const { segment, month, config } = e.target.dataset;
                    if (segment && month && config) {
                        let value;
                        if (config === 'sentiment') {
                            value = e.target.value;
                        } else {
                            value = parseFloat(e.target.value);
                            if (isNaN(value)) value = 0;
                        }

                        if (!this.state.manualOverrides[segment]) {
                            this.state.manualOverrides[segment] = {};
                        }
                        if (!this.state.manualOverrides[segment][month]) {
                            this.state.manualOverrides[segment][month] = {};
                        }

                        if (config === 'contactRate' && typeof value === 'number') {
                            this.state.manualOverrides[segment][month][config] = value / 100;
                        } else {
                            this.state.manualOverrides[segment][month][config] = value;
                        }
                        
                        this.saveOverrides();
                        this.updateCalculations();

                        // Apply visual feedback for the override in real-time
                        e.target.classList.add('manual-override');
                        const cellWrapper = e.target.parentElement;
                        if (cellWrapper && cellWrapper.classList.contains('cell-wrapper')) {
                            if (!cellWrapper.querySelector('.reset-button')) {
                                const resetButton = document.createElement('span');
                                resetButton.className = 'reset-button';
                                resetButton.innerHTML = '⟲';
                                resetButton.dataset.segment = segment;
                                resetButton.dataset.month = month;
                                resetButton.dataset.config = config;
                                cellWrapper.appendChild(resetButton);
                            }
                        }
                    }
                }
            });

            forecastContainer.addEventListener('click', (e) => {
                const lockToggle = e.target.closest('.lock-toggle');
                if (lockToggle) {
                    const { segment, month } = lockToggle.dataset;
                    if (segment && month) {
                        this.toggleRowLock(segment, month);
                    }
                }

                const resetButton = e.target.closest('.reset-button');
                if (resetButton) {
                    const { segment, month, config } = resetButton.dataset;
                    if (segment && month && config) {
                        this.clearManualOverride(segment, month, config);
                    }
                }

                const resetAllButton = e.target.closest('.reset-all-button');
                if (resetAllButton) {
                    const { segment, config } = resetAllButton.dataset;
                    if (segment && config) {
                        if (confirm(`Are you sure you want to reset all monthly overrides for this column in the ${this.state.segments[segment].name} segment?`)) {
                            this.clearAllOverridesForConfig(segment, config);
                        }
                    }
                }

                const columnLockToggle = e.target.closest('.column-lock-toggle');
                if (columnLockToggle) {
                    const { segment, config } = columnLockToggle.dataset;
                    if (segment && config) {
                        this.toggleColumnLock(segment, config);
                    }
                }
            });
        }
    }

    isAdminMode() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('admin') === 'true';
    }

    toggleRowLock(segmentKey, monthId) {
        if (!this.state.manualOverrides[segmentKey]) this.state.manualOverrides[segmentKey] = {};
        if (!this.state.manualOverrides[segmentKey][monthId]) this.state.manualOverrides[segmentKey][monthId] = {};
        
        const currentLockState = this.state.manualOverrides[segmentKey][monthId].isLocked || false;

        // If it's already locked, you must be an admin to unlock it.
        if (currentLockState && !this.isAdminMode()) {
            return; // Silently prevent unlocking
        }

        const isLocked = !currentLockState;
        this.state.manualOverrides[segmentKey][monthId].isLocked = isLocked;
        
        this.saveOverrides();

        // Update the DOM directly to avoid a full re-render
        const row = document.querySelector(`tr[data-segment="${segmentKey}"][data-month="${monthId}"]`);
        if (!row) return;

        row.classList.toggle('row-locked', isLocked);
        
        const inputs = row.querySelectorAll('input');
        inputs.forEach(input => {
            input.readOnly = isLocked;
        });

        const selects = row.querySelectorAll('select');
        selects.forEach(select => {
            select.disabled = isLocked;
        });

        const lockIcon = row.querySelector('.lock-toggle');
        if (lockIcon) {
            lockIcon.textContent = isLocked ? '🔒' : '🔓';
        }
    }

    // Get a config value, checking for override first, then fallback to segment default
    getConfigValue(segmentKey, month, configKey) {
        const monthId = month.month;
        const override = this.state.manualOverrides?.[segmentKey]?.[monthId]?.[configKey];

        if (override !== undefined && override !== null) {
            return override;
        }

        if (configKey === 'seasonalMultiplier') {
            if (month.isPastMonth || month.isCurrentMonth) {
                return 1.0;
            }
            return this.state.segments[segmentKey].config.seasonalMultiplier;
        }
        
        return this.state.segments[segmentKey].config[configKey];
    }

    getEffectiveCoreTeamSize(segmentKey, month) {
        let coreTeamSize = this.getConfigValue(segmentKey, month, 'coreTeamSize');

        if (segmentKey === 'nonvip') {
            const shiftToVip = this.getConfigValue('nonvip', month, 'shiftToVip') || 0;
            coreTeamSize -= shiftToVip;
        } else if (segmentKey === 'vip') {
            const shiftFromNonVip = this.getConfigValue('nonvip', month, 'shiftToVip') || 0;
            const shiftToPlus = this.getConfigValue('vip', month, 'shiftToPlus') || 0;
            coreTeamSize += shiftFromNonVip - shiftToPlus;
        } else if (segmentKey === 'plus') {
            const shiftFromVip = this.getConfigValue('vip', month, 'shiftToPlus') || 0;
            coreTeamSize += shiftFromVip;
        }

        return coreTeamSize;
    }

    // Main calculation engine
    calculateForecast(segmentKey, month) {
        const customers = this.getConfigValue(segmentKey, month, 'customers');
        const contactRate = this.getConfigValue(segmentKey, month, 'contactRate');
        const aiDeflection = this.getConfigValue(segmentKey, month, 'aiDeflection');
        const chatDeflection = this.getConfigValue(segmentKey, month, 'chatDeflection');
        const handleTimeImprovement = this.getConfigValue(segmentKey, month, 'handleTimeImprovement');
        const tdcxTeamSize = this.getConfigValue(segmentKey, month, 'tdcxTeamSize');
        const coreTicketsPerDay = this.getConfigValue(segmentKey, month, 'coreTicketsPerDay');
        const tdcxTicketsPerDay = this.getConfigValue(segmentKey, month, 'tdcxTicketsPerDay');
        const coreOvertime = this.getConfigValue(segmentKey, month, 'coreOvertime') || 0;

        const coreTeamSize = this.getEffectiveCoreTeamSize(segmentKey, month);

        // Est. Volume before seasonal multiplier
        const estVolume = Math.round(customers * contactRate);

        // Correctly determine seasonal multiplier, prioritizing override
        const seasonalMultiplier = this.getConfigValue(segmentKey, month, 'seasonalMultiplier');

        // Base volume calculation
        const totalVolume = Math.round(estVolume * seasonalMultiplier);

        // Deflection calculations
        const aiDeflectedVolume = Math.round(totalVolume * (aiDeflection / 100));
        const chatDeflectedVolume = Math.round(totalVolume * (chatDeflection / 100));
        const remainingVolume = totalVolume - aiDeflectedVolume - chatDeflectedVolume;

        // TDCX volume calculation
        const tdcxMaxCapacity = tdcxTeamSize * tdcxTicketsPerDay * this.constants.WORKING_DAYS_PER_MONTH;
        const tdcxVolume = tdcxTeamSize > 0 ? Math.min(remainingVolume, tdcxMaxCapacity) : 0;

        // Core team volume
        const coreTeamVolume = remainingVolume - tdcxVolume;

        // FTE calculations
        const coreTicketsPerMonth = coreTicketsPerDay * this.constants.WORKING_DAYS_PER_MONTH * this.constants.OCCUPANCY_RATE;
        const requiredFTEs = coreTicketsPerMonth > 0 ? Math.ceil(coreTeamVolume / coreTicketsPerMonth) : 0;
        
        // Handle time improvement impact
        const efficiencyMultiplier = 1 - (handleTimeImprovement / 100);
        const coreTicketsPerMonthWithImprovement = coreTicketsPerMonth > 0 ? (coreTicketsPerMonth / efficiencyMultiplier) : 0;
        const requiredFTEsWithImprovement = coreTicketsPerMonthWithImprovement > 0 ? Math.ceil(coreTeamVolume / coreTicketsPerMonthWithImprovement) : 0;
        
        // Gap calculation
        const gap = requiredFTEsWithImprovement - (coreTeamSize + coreOvertime);

        // TDCX percentage
        const tdcxPercentOfTotal = remainingVolume > 0 ? ((tdcxVolume / remainingVolume) * 100).toFixed(1) : '0.0';

        return {
            estVolume,
            totalVolume,
            aiDeflectedVolume,
            chatDeflectedVolume,
            remainingVolume,
            tdcxVolume,
            coreTeamVolume,
            requiredFTEs,
            requiredFTEsWithImprovement,
            gap,
            tdcxPercentOfTotal,
        };
    }

    // Update all calculations and re-render
    updateCalculations() {
        this.updateForecastValues();
        this.updateCharts();
        this.saveState();
    }

    // NEW: Update only the calculated values in the DOM to prevent input focus loss
    updateForecastValues() {
        this.state.months.forEach(month => {
            Object.keys(this.state.segments).forEach(segmentKey => {
                const forecast = this.calculateForecast(segmentKey, month);
                
                const updateCell = (cellKey, value, isLocaleString = true) => {
                    const element = document.querySelector(`[data-segment="${segmentKey}"][data-month="${month.month}"][data-cell="${cellKey}"]`);
                    if (element) {
                        element.textContent = isLocaleString ? value.toLocaleString() : value;
                    }
                };
                
                updateCell('estVolume', forecast.estVolume);
                updateCell('totalVolume', forecast.totalVolume);
                updateCell('aiDeflectedVolume', forecast.aiDeflectedVolume);
                updateCell('chatDeflectedVolume', forecast.chatDeflectedVolume);
                updateCell('postDeflectionVolume', forecast.remainingVolume);
                updateCell('tdcxVolume', forecast.tdcxVolume);
                updateCell('tdcxPercentOfTotal', `${forecast.tdcxPercentOfTotal}%`, false);
                updateCell('coreTeamVolume', forecast.coreTeamVolume);
                
                const requiredFTEsMainEl = document.querySelector(`[data-segment="${segmentKey}"][data-month="${month.month}"][data-cell="requiredFTEs"] .main-value`);
                if (requiredFTEsMainEl) requiredFTEsMainEl.textContent = forecast.requiredFTEs;
                
                const requiredFTEsImprovementEl = document.querySelector(`[data-segment="${segmentKey}"][data-month="${month.month}"][data-cell="requiredFTEs"] .impact-below`);
                if (requiredFTEsImprovementEl) requiredFTEsImprovementEl.textContent = `(${forecast.requiredFTEsWithImprovement})`;

                const gapEl = document.querySelector(`[data-segment="${segmentKey}"][data-month="${month.month}"][data-cell="gap"]`);
                if (gapEl) {
                    gapEl.textContent = forecast.gap;
                    gapEl.className = 'gap-cell'; // Reset class
                    const gapColorClass = forecast.gap > 2 ? 'status-negative' : forecast.gap > 0 ? 'status-warning' : 'status-positive';
                    gapEl.classList.add(gapColorClass);
                }
            });
        });
    }

    // Render the main interface
    render() {
        const configContainer = document.getElementById('configContainer');
        const forecastContainer = document.getElementById('forecastContainer');
        
        if (!configContainer || !forecastContainer) return;

        configContainer.innerHTML = '';
        forecastContainer.innerHTML = '';

        // Render each segment's config and forecast table
        Object.keys(this.state.segments).forEach(segmentKey => {
            const segment = this.state.segments[segmentKey];
            
            configContainer.innerHTML += this.renderSegmentConfig(segmentKey, segment);
            forecastContainer.innerHTML += this.renderSegmentForecast(segmentKey, segment);
        });

    }

    // Render configuration panel for a segment
    renderSegmentConfig(segmentKey, segment) {
        const config = segment.config;
        return `
            <div class="card">
                <h2 style="color: ${segment.color}">${segment.name} Segment Default Configuration</h2>
                <div class="form-grid">
                    <div class="form-group">
                        <label for="${segmentKey}-customers">Customer Base</label>
                        <input type="number" id="${segmentKey}-customers" data-segment="${segmentKey}" data-config="customers" value="${config.customers}" min="0">
                    </div>
                    <div class="form-group">
                        <label for="${segmentKey}-contactRate">Contact Rate (%)</label>
                        <input type="number" id="${segmentKey}-contactRate" data-segment="${segmentKey}" data-config="contactRate" value="${config.contactRate * 100}" step="0.01" min="0">
                    </div>
                    <div class="form-group">
                        <label for="${segmentKey}-aiDeflection">⚡️Future AI Deflection %</label>
                        <input type="number" id="${segmentKey}-aiDeflection" data-segment="${segmentKey}" data-config="aiDeflection" value="${config.aiDeflection}" min="0" max="100" step="0.1">
                    </div>
                    <div class="form-group">
                        <label for="${segmentKey}-chatDeflection">⚡️Future Chat Deflection %</label>
                        <input type="number" id="${segmentKey}-chatDeflection" data-segment="${segmentKey}" data-config="chatDeflection" value="${config.chatDeflection}" min="0" max="100" step="0.1">
                    </div>
                    <div class="form-group">
                        <label for="${segmentKey}-handleTimeImprovement">⚡️% Improvement in Handle Time</label>
                        <input type="number" id="${segmentKey}-handleTimeImprovement" data-segment="${segmentKey}" data-config="handleTimeImprovement" value="${config.handleTimeImprovement}" min="0" max="100" step="0.1">
                    </div>
                    <div class="form-group">
                        <label for="${segmentKey}-coreTeamSize">Core Team Size (FTEs)</label>
                        <input type="number" id="${segmentKey}-coreTeamSize" data-segment="${segmentKey}" data-config="coreTeamSize" value="${config.coreTeamSize}" min="0" step="0.1">
                    </div>
                    <div class="form-group">
                        <label for="${segmentKey}-tdcxTeamSize">TDCX Team Size (FTEs)</label>
                        <input type="number" id="${segmentKey}-tdcxTeamSize" data-segment="${segmentKey}" data-config="tdcxTeamSize" value="${config.tdcxTeamSize}" min="0" step="0.1">
                    </div>
                    <div class="form-group">
                        <label for="${segmentKey}-coreTicketsPerDay">Tickets per Core FTE per Day</label>
                        <input type="number" id="${segmentKey}-coreTicketsPerDay" data-segment="${segmentKey}" data-config="coreTicketsPerDay" value="${config.coreTicketsPerDay}" min="0" step="0.1">
                    </div>
                    <div class="form-group">
                        <label for="${segmentKey}-tdcxTicketsPerDay">TDCX Tickets per Day</label>
                        <input type="number" id="${segmentKey}-tdcxTicketsPerDay" data-segment="${segmentKey}" data-config="tdcxTicketsPerDay" value="${config.tdcxTicketsPerDay}" min="0" step="0.1">
                    </div>
                    <div class="form-group">
                        <label for="${segmentKey}-seasonalMultiplier">Default Seasonal Multiplier</label>
                        <input type="number" id="${segmentKey}-seasonalMultiplier" data-segment="${segmentKey}" data-config="seasonalMultiplier" value="${config.seasonalMultiplier}" min="0" step="0.1">
                    </div>
                </div>
            </div>
        `;
    }

    // Render forecast table for a segment
    renderSegmentForecast(segmentKey, segment) {
        const months = this.state.months.map(month => {
            const isLocked = this.getConfigValue(segmentKey, month, 'isLocked') || false;
            const isCurrentMonth = month.isCurrentMonth ? 'background: #e3f2fd;' : '';
            return `
                <tr style="${isCurrentMonth}" class="${isLocked ? 'row-locked' : ''}" data-segment="${segmentKey}" data-month="${month.month}">
                    ${this.renderTableRow(month, segmentKey)}
                </tr>
            `;
        }).join('');

        let shiftHeader = '';
        if (segmentKey === 'nonvip') {
            shiftHeader = '<th>Shift to VIP</th>';
        } else if (segmentKey === 'vip') {
            shiftHeader = '<th>Shift to Plus</th>';
        } else {
            shiftHeader = '<th></th>'; // Empty header for Plus segment
        }

        const createHeaderCell = (label, configKey) => {
            if (configKey) {
                const isLocked = this.isColumnLocked(segmentKey, configKey);
                const lockIcon = isLocked ? '🔒' : '🔓';
                const lockToggle = this.isAdminMode() ? `<span class="column-lock-toggle" data-segment="${segmentKey}" data-config="${configKey}" title="Admin: Lock/Unlock this column">${lockIcon}</span>` : '';
                const resetAllButton = !isLocked ? `<span class="reset-all-button" data-segment="${segmentKey}" data-config="${configKey}" title="Reset all monthly overrides for ${label}">⟲</span>` : '';
                return `<th>${label} ${lockToggle} ${resetAllButton}</th>`;
            }
            return `<th>${label}</th>`;
        };

        return `
            <div class="card">
                <h2 style="color: ${segment.color}">${segment.name} Segment Forecast</h2>
                <div class="table-container">
                    <table class="forecast-table">
                        <thead>
                            <tr>
                                <th class="sticky-col">Month</th>
                                ${createHeaderCell('Customer Base', 'customers')}
                                ${createHeaderCell('Contact Rate (%)', 'contactRate')}
                                ${createHeaderCell('Est. Volume')}
                                ${createHeaderCell('Seasonal Multiplier', 'seasonalMultiplier')}
                                ${createHeaderCell('Total Volume')}
                                ${createHeaderCell('⚡️AI Deflection %', 'aiDeflection')}
                                ${createHeaderCell('AI Deflected')}
                                ${createHeaderCell('⚡️Chat Deflection %', 'chatDeflection')}
                                ${createHeaderCell('Chat Deflected')}
                                ${createHeaderCell('Post-Deflection Volume')}
                                ${createHeaderCell('TDCX Team Size', 'tdcxTeamSize')}
                                ${createHeaderCell('TDCX Tickets/Day', 'tdcxTicketsPerDay')}
                                ${createHeaderCell('TDCX Volume')}
                                ${createHeaderCell('TDCX %')}
                                ${createHeaderCell('Remaining Volume')}
                                ${createHeaderCell('Core Team Size', 'coreTeamSize')}
                                ${createHeaderCell('Core Overtime', 'coreOvertime')}
                                ${createHeaderCell('Core Tickets/Day', 'coreTicketsPerDay')}
                                ${createHeaderCell('⚡️% Improvement in Handle Time', 'handleTimeImprovement')}
                                ${shiftHeader}
                                ${createHeaderCell('Required FTEs')}
                                ${createHeaderCell('Gap')}
                                ${createHeaderCell('Sentiment')}
                                ${createHeaderCell('Lock')}
                            </tr>
                        </thead>
                        <tbody>
                            ${months}
                        </tbody>
                    </table>
                </div>
                <div class="chart-container" style="margin-top: 20px;">
                    <canvas id="chart-${segmentKey}"></canvas>
                </div>
            </div>
        `;
    }

    // Render table row
    renderTableRow(month, segmentKey) {
        const forecast = this.calculateForecast(segmentKey, month);
        
        const customerBase = this.getConfigValue(segmentKey, month, 'customers');
        const contactRate = this.getConfigValue(segmentKey, month, 'contactRate');
        const aiDeflection = this.getConfigValue(segmentKey, month, 'aiDeflection');
        const chatDeflection = this.getConfigValue(segmentKey, month, 'chatDeflection');
        const handleTimeImprovement = this.getConfigValue(segmentKey, month, 'handleTimeImprovement');
        const tdcxTeamSize = this.getConfigValue(segmentKey, month, 'tdcxTeamSize');
        const tdcxTicketsPerDay = this.getConfigValue(segmentKey, month, 'tdcxTicketsPerDay');
        const coreTeamSize = this.getConfigValue(segmentKey, month, 'coreTeamSize');
        const coreTicketsPerDay = this.getConfigValue(segmentKey, month, 'coreTicketsPerDay');
        const seasonalMultiplier = this.getConfigValue(segmentKey, month, 'seasonalMultiplier');
        const coreOvertime = this.getConfigValue(segmentKey, month, 'coreOvertime') || 0;
        const isRowLocked = this.getConfigValue(segmentKey, month, 'isLocked') || false;

        const isCurrentMonth = month.isCurrentMonth ? 'background: #e3f2fd;' : '';
        const gapColor = forecast.gap > 2 ? 'status-negative' : forecast.gap > 0 ? 'status-warning' : 'status-positive';

        let shiftInput = '';
        if (segmentKey === 'nonvip') {
            const shiftToVip = this.getConfigValue(segmentKey, month, 'shiftToVip') || 0;
            shiftInput = `<td><input type="number" value="${shiftToVip}" data-segment="${segmentKey}" data-month="${month.month}" data-config="shiftToVip" step="1" min="0" ${isRowLocked ? 'readonly' : ''}></td>`;
        } else if (segmentKey === 'vip') {
            const shiftToPlus = this.getConfigValue(segmentKey, month, 'shiftToPlus') || 0;
            shiftInput = `<td><input type="number" value="${shiftToPlus}" data-segment="${segmentKey}" data-month="${month.month}" data-config="shiftToPlus" step="1" min="0" ${isRowLocked ? 'readonly' : ''}></td>`;
        } else {
            shiftInput = '<td></td>'; // Empty cell for Plus segment
        }

        let sentimentInput = '<td></td>';
        if (month.isPastMonth || month.isCurrentMonth) {
            const sentiment = this.getConfigValue(segmentKey, month, 'sentiment') || '';
            sentimentInput = `
                <td>
                    <select data-segment="${segmentKey}" data-month="${month.month}" data-config="sentiment" style="font-size: 16px; border-radius: 4px; border: 1px solid #ddd;" ${isRowLocked ? 'disabled' : ''}>
                        <option value=""></option>
                        <option value="🙂" ${sentiment === '🙂' ? 'selected' : ''}>🙂</option>
                        <option value="😐" ${sentiment === '😐' ? 'selected' : ''}>😐</option>
                        <option value="☹️" ${sentiment === '☹️' ? 'selected' : ''}>☹️</option>
                    </select>
                </td>
            `;
        }

        const lockIcon = isRowLocked ? '🔒' : '🔓';
        const canToggle = this.isAdminMode() || !isRowLocked;

        const lockCell = `
            <td>
                <span class="${canToggle ? 'lock-toggle' : ''}" data-segment="${segmentKey}" data-month="${month.month}" style="cursor: ${canToggle ? 'pointer' : 'default'}; font-size: 16px;">
                    ${lockIcon}
                </span>
            </td>`;

        const createEditableCell = (configKey, value, options = {}) => {
            const override = this.state.manualOverrides?.[segmentKey]?.[month.month]?.[configKey];
            const isOverridden = override !== undefined && override !== null;
            const isColLocked = this.isColumnLocked(segmentKey, configKey);

            const inputType = options.type || 'number';
            const step = options.step || '1';
            const min = options.min || '0';
            const isPercent = options.isPercent || false;
            const displayValue = isPercent ? value * 100 : value;

            const inputClass = isOverridden ? 'manual-override' : '';
            const resetButton = isOverridden && !isRowLocked && !isColLocked ? `<span class="reset-button" data-segment="${segmentKey}" data-month="${month.month}" data-config="${configKey}">⟲</span>` : '';
            
            return `
                <td>
                    <div class="cell-wrapper">
                        <input type="${inputType}" value="${displayValue}" class="${inputClass}" data-segment="${segmentKey}" data-month="${month.month}" data-config="${configKey}" step="${step}" min="${min}" ${isRowLocked || isColLocked ? 'readonly' : ''}>
                        ${resetButton}
                    </div>
                </td>`;
        };
        
        return `
            <td class="sticky-col">${month.month}</td>
            ${createEditableCell('customers', customerBase)}
            ${createEditableCell('contactRate', contactRate, { isPercent: true, step: '0.1' })}
            <td data-segment="${segmentKey}" data-month="${month.month}" data-cell="estVolume">${forecast.estVolume.toLocaleString()}</td>
            ${createEditableCell('seasonalMultiplier', seasonalMultiplier, { step: '0.01' })}
            <td data-segment="${segmentKey}" data-month="${month.month}" data-cell="totalVolume">${forecast.totalVolume.toLocaleString()}</td>
            ${createEditableCell('aiDeflection', aiDeflection, { step: '0.1' })}
            <td data-segment="${segmentKey}" data-month="${month.month}" data-cell="aiDeflectedVolume">${forecast.aiDeflectedVolume.toLocaleString()}</td>
            ${createEditableCell('⚡️Chat Deflection %', 'chatDeflection', { step: '0.1' })}
            <td data-segment="${segmentKey}" data-month="${month.month}" data-cell="chatDeflectedVolume">${forecast.chatDeflectedVolume.toLocaleString()}</td>
            <td data-segment="${segmentKey}" data-month="${month.month}" data-cell="postDeflectionVolume">${forecast.remainingVolume.toLocaleString()}</td>
            ${createEditableCell('TDCX Team Size', 'tdcxTeamSize', { step: '0.1' })}
            ${createEditableCell('tdcxTicketsPerDay', tdcxTicketsPerDay, { step: '0.1' })}
            <td data-segment="${segmentKey}" data-month="${month.month}" data-cell="tdcxVolume">${forecast.tdcxVolume.toLocaleString()}</td>
            <td data-segment="${segmentKey}" data-month="${month.month}" data-cell="tdcxPercentOfTotal" class="non-editable-cell">${forecast.tdcxPercentOfTotal}%</td>
            <td data-segment="${segmentKey}" data-month="${month.month}" data-cell="coreTeamVolume">${forecast.coreTeamVolume.toLocaleString()}</td>
            ${createEditableCell('coreTeamSize', coreTeamSize, { step: '0.1' })}
            ${createEditableCell('coreOvertime', coreOvertime, { step: '0.1' })}
            ${createEditableCell('coreTicketsPerDay', coreTicketsPerDay, { step: '0.1' })}
            ${createEditableCell('handleTimeImprovement', handleTimeImprovement, { step: '0.1' })}
            ${shiftInput}
            <td class="required-ftes-cell" data-segment="${segmentKey}" data-month="${month.month}" data-cell="requiredFTEs">
                <div class="main-value">${forecast.requiredFTEs}</div>
                <div class="impact-below">(${forecast.requiredFTEsWithImprovement})</div>
            </td>
            <td class="gap-cell ${gapColor}" data-segment="${segmentKey}" data-month="${month.month}" data-cell="gap">${forecast.gap}</td>
            ${sentimentInput}
            ${lockCell}
        `;
    }

    // Helper function to create a stripe pattern for the chart
    _createStripePattern(chartCtx, mainColor, stripeColor) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const size = 8;
        canvas.width = size;
        canvas.height = size;
        
        ctx.fillStyle = mainColor;
        ctx.fillRect(0, 0, size, size);
        
        ctx.strokeStyle = stripeColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, size);
        ctx.lineTo(size, 0);
        ctx.stroke();
        
        return chartCtx.createPattern(canvas, 'repeat');
    }

    // Setup charts
    setupCharts() {
        Object.keys(this.state.segments).forEach(segmentKey => {
            this.createChart(segmentKey);
        });
    }

    // Create chart for segment
    createChart(segmentKey) {
        const ctx = document.getElementById(`chart-${segmentKey}`);
        if (!ctx) return;
        const chartCtx = ctx.getContext('2d');

        const months = this.state.months.map(month => {
            const forecast = this.calculateForecast(segmentKey, month);
            return { ...month, ...forecast };
        });

        const segment = this.state.segments[segmentKey];

        const backgroundColors = months.map(month => {
            if (month.isPastMonth) {
                if (month.gap <= 0) return 'rgba(39, 174, 96, 0.5)'; // Light Green
                if (month.gap <= 2) return 'rgba(241, 196, 15, 0.5)'; // Light Yellow
                return this._createStripePattern(chartCtx, 'rgba(231, 76, 60, 0.5)', 'rgba(192, 57, 43, 0.7)');
            } else {
                if (month.gap <= 0) return '#27ae60'; // Green
                if (month.gap <= 2) return '#f1c40f'; // Yellow
                return '#e74c3c'; // Red
            }
        });

        const sentimentPlugin = {
            id: 'sentimentEmoji',
            afterDraw: (chart) => {
                const ctx = chart.ctx;
                chart.getDatasetMeta(0).data.forEach((bar, index) => {
                    const month = this.state.months[index];
                    const sentiment = this.getConfigValue(segmentKey, month, 'sentiment');
                    if (sentiment) {
                        ctx.save();
                        ctx.font = '16px sans-serif';
                        ctx.textAlign = 'center';
                        
                        const yPos = bar.y - 10;
                        let finalY;
                        let fillStyle = '#444';

                        if (yPos < 20) { // If emoji would be off-screen, draw inside the bar
                            finalY = bar.y + 20;
                            fillStyle = '#fff';
                        } else {
                            finalY = yPos;
                        }
                        
                        ctx.fillStyle = fillStyle;
                        ctx.fillText(sentiment, bar.x, finalY);
                        ctx.restore();
                    }
                });
            }
        };

        const zeroLinePlugin = {
            id: 'zeroLineForGap',
            afterDraw: (chart) => {
                const ctx = chart.ctx;
                const meta = chart.getDatasetMeta(0); // Assuming one dataset
                const yAxis = chart.scales.y;
        
                meta.data.forEach((bar, index) => {
                    const month = months[index]; // The `months` array from the outer scope
                    const gapValue = month.gap;
        
                    if (gapValue === 0) {
                        ctx.save();
                        // Use the same color logic as for positive bars, but make it solid
                        ctx.strokeStyle = month.isPastMonth ? 'rgba(39, 174, 96, 0.8)' : '#27ae60';
                        ctx.lineWidth = 3; // Make it a noticeable line
                        
                        const y = yAxis.getPixelForValue(0);
                        const xStart = bar.x - bar.width / 2;
                        const xEnd = bar.x + bar.width / 2;
        
                        ctx.beginPath();
                        ctx.moveTo(xStart, y);
                        ctx.lineTo(xEnd, y);
                        ctx.stroke();
                        
                        ctx.restore();
                    }
                });
            }
        };

        new Chart(ctx, {
            type: 'bar',
            data: {
                labels: months.map(m => m.month),
                datasets: [{
                    label: 'FTEs Needed (Gap)',
                    data: months.map(m => m.gap),
                    backgroundColor: backgroundColors,
                    borderColor: 'rgba(0,0,0,0.1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    },
                    title: {
                        display: true,
                        text: `${segment.name} FTEs Needed (Gap)`
                    }
                },
                scales: {
                    y: {
                        title: {
                            display: true,
                            text: 'FTEs Needed'
                        }
                    }
                }
            },
            plugins: [sentimentPlugin, zeroLinePlugin]
        });
    }

    // Update charts
    updateCharts() {
        // Destroy existing charts and recreate
        Chart.helpers.each(Chart.instances, (instance) => {
            instance.destroy();
        });
        this.setupCharts();
    }

    // State persistence
    saveState() {
        try {
            const stateToSave = {
                segments: this.state.segments,
                columnLocks: this.state.columnLocks
            };
            localStorage.setItem('superforecaster-state', JSON.stringify(stateToSave));
        } catch (error) {
            console.warn('Failed to save state:', error);
        }
    }

    loadState() {
        try {
            const savedState = localStorage.getItem('superforecaster-state');
            if (savedState) {
                const parsedState = JSON.parse(savedState);
                // Deep merge configs to avoid issues if new properties are added
                Object.keys(parsedState.segments).forEach(segmentKey => {
                    if (this.state.segments[segmentKey]) {
                        this.state.segments[segmentKey].config = {
                            ...this.state.segments[segmentKey].config,
                            ...parsedState.segments[segmentKey].config
                        };
                    }
                });

                if (parsedState.columnLocks) {
                    this.state.columnLocks = parsedState.columnLocks;
                }
            }
        } catch (error) {
            console.warn('Failed to load state:', error);
        }
    }

    loadOverrides() {
        try {
            const saved = localStorage.getItem('superforecaster-overrides');
            if (saved) {
                const savedOverrides = JSON.parse(saved);
                // Deep merge saved overrides into the default overrides
                this.state.manualOverrides = this._deepMerge(this.state.manualOverrides, savedOverrides);
            }
        } catch (error) {
            console.warn('Failed to load overrides:', error);
        }
    }

    saveOverrides() {
        try {
            localStorage.setItem('superforecaster-overrides', JSON.stringify(this.state.manualOverrides));
        } catch (error) {
            console.warn('Failed to save overrides:', error);
        }
    }

    // Helper for deep merging states
    _isObject(item) {
        return (item && typeof item === 'object' && !Array.isArray(item));
    }

    _deepMerge(target, source) {
        const output = { ...target };
        if (this._isObject(target) && this._isObject(source)) {
            Object.keys(source).forEach(key => {
                if (this._isObject(source[key])) {
                    if (!(key in target))
                        Object.assign(output, { [key]: source[key] });
                    else
                        output[key] = this._deepMerge(target[key], source[key]);
                } else {
                    Object.assign(output, { [key]: source[key] });
                }
            });
        }
        return output;
    }

    clearManualOverride(segmentKey, monthId, configKey) {
        if (this.state.manualOverrides?.[segmentKey]?.[monthId]?.[configKey] !== undefined) {
            delete this.state.manualOverrides[segmentKey][monthId][configKey];

            // Clean up empty objects
            if (Object.keys(this.state.manualOverrides[segmentKey][monthId]).length === 0) {
                delete this.state.manualOverrides[segmentKey][monthId];
            }
            if (Object.keys(this.state.manualOverrides[segmentKey]).length === 0) {
                delete this.state.manualOverrides[segmentKey];
            }

            this.saveOverrides();

            // Re-render the affected row's content
            const rowElement = document.querySelector(`tr[data-segment="${segmentKey}"][data-month="${monthId}"]`);
            const monthObject = this.state.months.find(m => m.month === monthId);
            if (rowElement && monthObject) {
                rowElement.innerHTML = this.renderTableRow(monthObject, segmentKey);
            }

            this.updateCalculations();
        }
    }

    clearAllOverridesForConfig(segmentKey, configKey) {
        if (this.isColumnLocked(segmentKey, configKey)) {
            return; // Column is locked, do nothing.
        }

        if (this.state.manualOverrides?.[segmentKey]) {
            Object.keys(this.state.manualOverrides[segmentKey]).forEach(monthId => {
                const isRowLocked = this.state.manualOverrides[segmentKey]?.[monthId]?.isLocked || false;

                if (!isRowLocked && this.state.manualOverrides[segmentKey][monthId]?.[configKey] !== undefined) {
                    delete this.state.manualOverrides[segmentKey][monthId][configKey];
                }
                // Clean up empty month objects
                if (Object.keys(this.state.manualOverrides[segmentKey][monthId]).length === 0) {
                    delete this.state.manualOverrides[segmentKey][monthId];
                }
            });
    
            // Clean up empty segment object
            if (Object.keys(this.state.manualOverrides[segmentKey]).length === 0) {
                delete this.state.manualOverrides[segmentKey];
            }
    
            this.saveOverrides();
            this.render(); // Re-render everything to be safe
        }
    }

    isColumnLocked(segmentKey, configKey) {
        return this.state.columnLocks?.[segmentKey]?.[configKey] || false;
    }

    toggleColumnLock(segmentKey, configKey) {
        if (!this.isAdminMode()) {
            return; // Silently prevent non-admins from changing locks
        }

        if (!this.state.columnLocks[segmentKey]) {
            this.state.columnLocks[segmentKey] = {};
        }

        const isLocked = !this.isColumnLocked(segmentKey, configKey);
        this.state.columnLocks[segmentKey][configKey] = isLocked;

        this.saveState();
        this.render(); // Re-render to update the entire UI state
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.superForecaster = new SuperForecaster();
});

// Test commit to verify user configuration.
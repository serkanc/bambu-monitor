const bindTemperaturePanel = ({ controls, showToast }) => {
    if (!controls || !controls.temperatureButtons) {
        return;
    }

    controls.temperatureButtons.forEach((button) => {
        button.addEventListener('click', async () => {
            const action = button.dataset.action;
            if (action === 'set-nozzle') {
                const value = Number(controls.nozzleInput?.value || 0);
                if (!Number.isFinite(value) || value < 0) {
                    showToast('Enter a valid nozzle temperature.', 'error');
                    return;
                }

                try {
                    await controls.sendCommand('/api/control/command', {
                        command: 'gcode_line',
                        param: `M104 S${value}`,
                    });
                    showToast(`Nozzle temperature set to ${value}C.`, 'success');
                } catch (error) {
                    showToast(`Nozzle command failed: ${error.message}`, 'error');
                }
            } else if (action === 'off-nozzle') {
                try {
                    await controls.sendCommand('/api/control/command', {
                        command: 'gcode_line',
                        param: 'M104 S0',
                    });
                    showToast('Nozzle turned off (0C).', 'success');
                } catch (error) {
                    showToast(`Failed to turn off nozzle: ${error.message}`, 'error');
                }
            } else if (action === 'set-bed') {
                const value = Number(controls.bedInput?.value || 0);
                if (!Number.isFinite(value) || value < 0) {
                    showToast('Enter a valid bed temperature.', 'error');
                    return;
                }
                try {
                    await controls.sendCommand('/api/control/command', {
                        command: 'gcode_line',
                        param: `M140 S${value}`,
                    });
                    showToast(`Bed temperature set to ${value}C.`, 'success');
                } catch (error) {
                    showToast(`Bed command failed: ${error.message}`, 'error');
                }
            } else if (action === 'off-bed') {
                try {
                    await controls.sendCommand('/api/control/command', {
                        command: 'gcode_line',
                        param: 'M140 S0',
                    });
                    showToast('Bed turned off (0C).', 'success');
                } catch (error) {
                    showToast(`Failed to turn off bed: ${error.message}`, 'error');
                }
            }
        });
    });
};

export { bindTemperaturePanel };
export default bindTemperaturePanel;

const bindMovementPanel = ({ controls, showToast, getSnapshot }) => {
    if (!controls || !controls.stepButtons || !controls.movementControlButtons) {
        return;
    }
    if (!controls.stepButtons.length) {
        return;
    }

    const getActiveStep = () => {
        const snapshot = typeof getSnapshot === 'function' ? getSnapshot() : null;
        const raw = controls.getMovementStep ? controls.getMovementStep(snapshot) : 1;
        const parsed = Number.parseFloat(raw);
        return Number.isFinite(parsed) ? parsed : 1;
    };

    controls.stepButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            const raw = btn.dataset.step || '1';
            const parsed = Number.parseFloat(raw);
            if (Number.isFinite(parsed)) {
                controls.setMovementStep(parsed);
            }
        });
    });
    controls.movementControlButtons.forEach((button) => {
        button.addEventListener('click', async () => {
            const group = button.closest('.axis-group');
            if (!group) {
                return;
            }
            const axis = group.dataset.axis || '';
            const direction = group.dataset.direction || '';
            const step = getActiveStep();
            const action = group.dataset.action || '';
            if (action === 'home') {
                let gcode = '';
                if (group.classList.contains('xy-home')) {
                    gcode = 'G28 X Y';
                }
                if (group.classList.contains('z-home')) {
                    gcode = 'G28 Z';
                }
                try {
                    await controls.sendCommand('/api/control/command', {
                        command: 'gcode_line',
                        param: gcode,
                    });
                    showToast(`Home command executed (${gcode})`, 'success');
                } catch (error) {
                    showToast(`Command failed: ${error.message}`, 'error');
                }
                return;
            }

            let gcodeMove = '';
            let dist = step;
            if (direction === 'left' || direction === 'down') {
                dist = -dist;
            }
            if (axis === 'X') gcodeMove = `G91\nG0 X${dist}`;
            if (axis === 'Y') gcodeMove = `G91\nG0 Y${dist}`;
            if (axis === 'Z') gcodeMove = `G91\nG0 Z${dist}`;
            try {
                await controls.sendCommand('/api/control/command', {
                    command: 'gcode_line',
                    param: gcodeMove,
                });
                showToast(`${axis}${direction} moved ${gcodeMove}`, 'success');
            } catch (error) {
                showToast(`Command failed: ${error.message}`, 'error');
            }
        });
    });
};

export { bindMovementPanel };
export default bindMovementPanel;

const bindExtruderPanel = ({ controls, showToast, getSnapshot, documentRef }) => {
    if (!controls || !controls.extruderButtons) {
        return;
    }
    const doc = documentRef || (typeof document !== 'undefined' ? document : null);
    const stepButtons = controls.extruderStepButtons || controls.extruderButtons || [];

    if (controls.extruderButtons.length) {
        controls.extruderButtons.forEach((btn) => {
            btn.addEventListener('click', () => {
                const raw = btn.dataset.length || '10';
                const parsed = Number.parseFloat(raw);
                if (Number.isFinite(parsed)) {
                    controls.setExtruderStep(parsed);
                }
            });
        });
    }

    const getActiveStep = () => {
        const snapshot = typeof getSnapshot === 'function' ? getSnapshot() : null;
        const raw = controls.getExtruderStep ? controls.getExtruderStep(snapshot) : 10;
        const parsed = Number.parseFloat(raw);
        return Number.isFinite(parsed) ? parsed : 10;
    };

    if (!doc) {
        return;
    }

    doc.querySelectorAll('.extrude-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const action = btn.dataset.action;
            const step = getActiveStep();
            let dist = step;
            if (action === 'retract') {
                dist = -dist;
            }
            const gcode = `G91\nG1 E${dist} F300`;
            try {
                await controls.sendCommand('/api/control/command', {
                    command: 'gcode_line',
                    param: gcode,
                });
                showToast(`${action} ${dist} mm executed`, 'success');
            } catch (error) {
                showToast(`${action} failed: ${error.message}`, 'error');
            }
        });
    });
};

export { bindExtruderPanel };
export default bindExtruderPanel;

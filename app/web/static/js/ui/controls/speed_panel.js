const bindSpeedPanel = ({
    controls,
    showToast,
    masterStore,
    selectors,
    speedModeToLevel,
    defaultPendingTtl = 5000,
}) => {
    if (!controls || !controls.speedButtons || !controls.speedButtons.length) {
        return;
    }
    controls.speedButtons.forEach((btn) => {
        btn.addEventListener('click', async () => {
            const mode = btn.dataset.mode;
            const param = speedModeToLevel[mode];
            if (!param) {
                showToast('Unknown speed mode.', 'error');
                return;
            }

            const targetLevel = Number(param);
            const snapshot = typeof masterStore?.getState === 'function' ? masterStore.getState() : null;
            const previousLevel = selectors.controls?.getSpeedLevel
                ? selectors.controls.getSpeedLevel(snapshot, Date.now())
                : snapshot?.printStatus?.speed_level;

            masterStore?.setControlsPendingValue?.('speedLevel', targetLevel, defaultPendingTtl);

            try {
                await controls.sendCommand('/api/control/command', {
                    command: 'print_speed',
                    param,
                });
                showToast(`Speed mode ${mode} set.`, 'success');
            } catch (error) {
                showToast(`Speed command failed: ${error.message}`, 'error');
                masterStore?.clearControlsPending?.('speedLevel');
            }
        });
    });
};

export { bindSpeedPanel };
export default bindSpeedPanel;

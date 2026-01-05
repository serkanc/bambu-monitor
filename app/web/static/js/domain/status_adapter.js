const isPlainObject = (value) =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const validateStatusPayload = (raw) => {
    const issues = [];
    if (!isPlainObject(raw)) {
        issues.push('payload');
        return issues;
    }
    if (raw.print !== undefined && !isPlainObject(raw.print)) {
        issues.push('print');
    }
    if (raw.ams !== undefined && raw.ams !== null && !isPlainObject(raw.ams)) {
        issues.push('ams');
    }
    if (raw.capabilities !== undefined && raw.capabilities !== null && !isPlainObject(raw.capabilities)) {
        issues.push('capabilities');
    }
    if (raw.server_info !== undefined && raw.server_info !== null && !isPlainObject(raw.server_info)) {
        issues.push('server_info');
    }
    if (isPlainObject(raw.print)) {
        if (raw.print.hms_errors !== undefined && !Array.isArray(raw.print.hms_errors)) {
            issues.push('print.hms_errors');
        }
        if (raw.print.feature_toggles !== undefined && !Array.isArray(raw.print.feature_toggles)) {
            issues.push('print.feature_toggles');
        }
    }
    return issues;
};

const adaptStatusPayload = (raw, { validate = false, onIssue } = {}) => {
    const payload = isPlainObject(raw) ? raw : {};
    const print = isPlainObject(payload.print) ? payload.print : {};
    const ams = isPlainObject(payload.ams) ? payload.ams : null;
    const capabilities = isPlainObject(payload.capabilities) ? payload.capabilities : null;
    const serverInfo = isPlainObject(payload.server_info) ? payload.server_info : undefined;

    if (validate) {
        const issues = validateStatusPayload(payload);
        if (issues.length && typeof onIssue === 'function') {
            onIssue(issues, payload);
        }
    }

    return {
        ...payload,
        print,
        ams,
        capabilities,
        server_info: serverInfo,
    };
};

export { adaptStatusPayload, validateStatusPayload };
export default adaptStatusPayload;

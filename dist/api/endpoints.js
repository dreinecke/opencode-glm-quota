/**
 * API endpoints module
 * Defines all API endpoints for ZAI and ZHIPU platforms
 */
/**
 * API endpoints configuration by platform
 */
const ENDPOINTS = {
    ZAI: {
        modelUsage: 'https://api.z.ai/api/monitor/usage/model-usage',
        toolUsage: 'https://api.z.ai/api/monitor/usage/tool-usage',
        quotaLimit: 'https://api.z.ai/api/monitor/usage/quota/limit'
    },
    ZHIPU: {
        modelUsage: 'https://open.bigmodel.cn/api/monitor/usage/model-usage',
        toolUsage: 'https://open.bigmodel.cn/api/monitor/usage/tool-usage',
        quotaLimit: 'https://open.bigmodel.cn/api/monitor/usage/quota/limit'
    },
    ZHIPU_DEV: {
        modelUsage: 'https://dev.bigmodel.cn/api/monitor/usage/model-usage',
        toolUsage: 'https://dev.bigmodel.cn/api/monitor/usage/tool-usage',
        quotaLimit: 'https://dev.bigmodel.cn/api/monitor/usage/quota/limit'
    }
};
/**
 * Get endpoints for a platform
 * @param platform - The platform type
 * @returns Endpoints configuration
 */
function getEndpoints(platform) {
    switch (platform) {
        case 'ZAI':
            return ENDPOINTS.ZAI;
        case 'ZHIPU':
            return ENDPOINTS.ZHIPU;
        default:
            return ENDPOINTS.ZAI;
    }
}
export { getEndpoints };

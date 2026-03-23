type LegacyPythonApi = typeof import('@/services/api').pythonApi;

const loadLegacyPythonApi = async (): Promise<LegacyPythonApi> => {
  const module = await import('@/services/api');
  return module.pythonApi;
};

export const pythonApi = {
  async analyzeQuantitativeData(...args: Parameters<LegacyPythonApi['analyzeQuantitativeData']>): ReturnType<LegacyPythonApi['analyzeQuantitativeData']> {
    return (await loadLegacyPythonApi()).analyzeQuantitativeData(...args);
  },

  async getChatResponse(...args: Parameters<LegacyPythonApi['getChatResponse']>): ReturnType<LegacyPythonApi['getChatResponse']> {
    return (await loadLegacyPythonApi()).getChatResponse(...args);
  },

  async generateChatTitle(...args: Parameters<LegacyPythonApi['generateChatTitle']>): ReturnType<LegacyPythonApi['generateChatTitle']> {
    return (await loadLegacyPythonApi()).generateChatTitle(...args);
  },

  async getChatResponseFromPython(...args: Parameters<LegacyPythonApi['getChatResponseFromPython']>): ReturnType<LegacyPythonApi['getChatResponseFromPython']> {
    return (await loadLegacyPythonApi()).getChatResponseFromPython(...args);
  },

  async getStockPrice(...args: Parameters<LegacyPythonApi['getStockPrice']>): ReturnType<LegacyPythonApi['getStockPrice']> {
    return (await loadLegacyPythonApi()).getStockPrice(...args);
  },
};

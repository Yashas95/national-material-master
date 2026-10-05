(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.NUMMF_API = factory();
    root.API = root.NUMMF_API;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const config = {
    baseUrl: (typeof window !== 'undefined' && window.NUMMF_API_BASE_URL) || 'http://localhost:4000/api/v1',
    token: null,
    role: 'SUPER_ADMIN',
    tenant: 'A',
    timeoutMs: 15000,
    offlineFallback: true,
  };

  class ApiError extends Error {
    constructor(message, status = 500, detail = null) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.detail = detail;
    }
  }

  async function request(endpoint, options = {}) {
    const url = endpoint.startsWith('http')
      ? endpoint
      : `${config.baseUrl}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;

    const headers = {
      Accept: 'application/json',
      ...(options.headers || {}),
    };

    if (config.token) {
      headers['Authorization'] = `Bearer ${config.token}`;
    }

    if (config.role) {
      headers['x-demo-role'] = config.role;
    }
    if (config.tenant) {
      headers['x-demo-tenant'] = config.tenant;
    }

    let body = options.body;
    if (body && typeof body === 'object' && !(body instanceof FormData) && !(typeof Blob !== 'undefined' && body instanceof Blob)) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeout = setTimeout(() => controller?.abort(), options.timeoutMs || config.timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        body,
        signal: controller?.signal,
      });

      clearTimeout(timeout);

      const contentType = response.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');
      const data = isJson ? await response.json() : await response.text();

      if (!response.ok) {
        const errorMsg = data?.message || `HTTP ${response.status}: ${response.statusText}`;
        throw new ApiError(errorMsg, response.status, data?.detail || data);
      }

      return data;
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof ApiError) throw err;
      throw new ApiError((err && err.message) || 'Network connection failed', 0, err);
    }
  }

  const API = {
    configure(options = {}) {
      Object.assign(config, options);
      return this;
    },

    setAuth(token, role = 'SUPER_ADMIN', tenant = 'A') {
      config.token = token;
      config.role = role;
      config.tenant = tenant;
      return this;
    },

    async switchPersona(role, tenant = 'A') {
      config.role = role;
      config.tenant = tenant;

      try {
        const res = await request('/auth/demo-login', {
          method: 'POST',
          body: { role, tenantId: tenant },
        });

        if (res && res.data && res.data.accessToken) {
          config.token = res.data.accessToken;
        }
        return res?.data?.user || { role, tenantId: tenant };
      } catch {
        return { role, tenantId: tenant };
      }
    },

    async getHealth() {
      return request('/health');
    },

    async getOverview() {
      const [materials, procStats, auditStats] = await Promise.all([
        request('/materials?limit=1').catch(() => ({ total: 117 })),
        request('/procurement/stats').catch(() => ({ data: { totalOpportunities: 108, totalCrossCpseSpend: 154000000, averagePriceSpread: 0.18 } })),
        request('/audit/stats').catch(() => ({ data: { blockedHarmonizations: 42, totalEvents: 500 } })),
      ]);

      return {
        nationalMaterialsCount: materials?.total || 117,
        procurementOpportunities: procStats?.data?.totalOpportunities || 108,
        totalCrossCpseSpend: procStats?.data?.totalCrossCpseSpend || 154000000,
        averagePriceSpread: procStats?.data?.averagePriceSpread || 0.18,
        blockedHarmonizations: auditStats?.data?.blockedHarmonizations || 42,
        totalAuditEvents: auditStats?.data?.totalEvents || 500,
      };
    },

    async getMaterials(params = {}) {
      const query = new URLSearchParams();
      if (params.page) query.set('page', String(params.page));
      if (params.limit) query.set('limit', String(params.limit));
      if (params.category) query.set('category', params.category);
      if (params.status) query.set('status', params.status);
      if (params.q) query.set('q', params.q);

      const qs = query.toString();
      return request(`/materials${qs ? '?' + qs : ''}`);
    },

    async getMaterial(id) {
      return request(`/materials/${encodeURIComponent(id)}`);
    },

    async getMappings(params = {}) {
      const query = new URLSearchParams();
      if (params.cpse) query.set('cpse', params.cpse);
      if (params.status) query.set('status', params.status);
      if (params.page) query.set('page', String(params.page));
      if (params.limit) query.set('limit', String(params.limit));

      const qs = query.toString();
      return request(`/mappings${qs ? '?' + qs : ''}`);
    },

    async naturalLanguageSearch(query, limit = 10) {
      return request('/materials/ai-search', {
        method: 'POST',
        body: { query, limit },
      });
    },

    async askGeminiSearch(query, limit = 10) {
      return this.naturalLanguageSearch(query, limit);
    },

    async exportCatalog(format = 'csv', params = {}) {
      const query = new URLSearchParams();
      query.set('format', format);
      if (params.category) query.set('category', params.category);
      if (params.status) query.set('status', params.status);
      if (params.q) query.set('q', params.q);

      return request(`/materials/export?${query.toString()}`);
    },

    async getAiExplanation(recordA, recordB) {
      return request('/decisions/explain', {
        method: 'POST',
        body: { recordA, recordB },
      });
    },

    async approveDecision(targetId, targetType = 'CLUSTER', note = '', forceL2 = false) {
      return request('/decisions/approve', {
        method: 'POST',
        body: { targetId, type: targetType, note, forceL2 },
      });
    },

    async modifyDecision(targetId, targetType = 'CLUSTER', standardDescription = '', reason = '') {
      return request('/decisions/modify', {
        method: 'POST',
        body: { targetId, standardDescription, note: reason },
      });
    },

    async rejectDecision(targetId, targetType = 'CLUSTER', reason = '') {
      return request('/decisions/reject', {
        method: 'POST',
        body: { targetId, type: targetType, reason },
      });
    },

    async escalateDecision(targetId, targetType = 'CLUSTER', note = '') {
      return request('/decisions/escalate', {
        method: 'POST',
        body: { targetId, type: targetType, note },
      });
    },

    async reopenDecision(targetId, targetType = 'CLUSTER', note = '') {
      return request('/decisions/reopen', {
        method: 'POST',
        body: { targetId, type: targetType, note },
      });
    },

    async uploadDataset(fileOrText, filename = 'upload.csv', options = {}) {
      if (typeof fileOrText === 'string') {
        return request('/intake/paste', {
          method: 'POST',
          body: {
            text: fileOrText,
            filename,
            dryRun: !!options.dryRun,
            cpseId: options.cpseId || config.tenant,
            async: !!options.async,
          },
        });
      }

      const formData = new FormData();
      formData.append('file', fileOrText, filename);
      if (options.dryRun) formData.append('dryRun', 'true');
      if (options.cpseId || config.tenant) formData.append('cpseId', options.cpseId || config.tenant);
      if (options.async) formData.append('async', 'true');

      return request('/intake/upload', {
        method: 'POST',
        body: formData,
      });
    },

    async uploadDatasetAsync(rawText, filename = 'bulk_upload.csv', options = {}) {
      return request('/jobs/intake', {
        method: 'POST',
        body: {
          rawText,
          filename,
          dryRun: !!options.dryRun,
          chunkSize: options.chunkSize || 25,
          cpseId: options.cpseId || config.tenant,
        },
      });
    },

    async getJobStatus(jobId) {
      return request(`/jobs/${encodeURIComponent(jobId)}`);
    },

    async listJobs(params = {}) {
      const query = new URLSearchParams();
      if (params.status) query.set('status', params.status);
      if (params.queueName) query.set('queueName', params.queueName);
      if (params.limit) query.set('limit', String(params.limit));

      const qs = query.toString();
      return request(`/jobs${qs ? '?' + qs : ''}`);
    },

    async cancelJob(jobId) {
      return request(`/jobs/${encodeURIComponent(jobId)}/cancel`, {
        method: 'POST',
      });
    },

    async getBatches() {
      return request('/intake/batches');
    },

    async getIntakeBatch(batchId) {
      return request(`/intake/batches/${encodeURIComponent(batchId)}`);
    },

    async uploadIntakeFile(file, cpseId, dryRun = false, isAsync = false) {
      return this.uploadDataset(file, file.name || 'upload.csv', {
        cpseId: cpseId || config.tenant,
        dryRun: !!dryRun,
        async: !!isAsync,
      });
    },

    async pasteIntakeRows(rowsOrText, cpseId, dryRun = false, isAsync = false) {
      const text = typeof rowsOrText === 'string' ? rowsOrText : JSON.stringify(rowsOrText);
      return request('/intake/paste', {
        method: 'POST',
        body: {
          text,
          filename: typeof rowsOrText === 'string' ? 'pasted-rows.csv' : 'pasted-rows.json',
          dryRun: !!dryRun,
          cpseId: cpseId || config.tenant,
          async: !!isAsync,
        },
      });
    },

    async getProcurementOpportunities(params = {}) {
      const query = new URLSearchParams();
      if (params.category) query.set('category', params.category);
      if (params.minCpses) query.set('minCpses', String(params.minCpses));
      if (params.minSpend) query.set('minSpend', String(params.minSpend));
      if (params.outliersOnly) query.set('outliersOnly', 'true');
      if (params.q) query.set('q', params.q);
      if (params.page) query.set('page', String(params.page));
      if (params.limit) query.set('limit', String(params.limit));

      const qs = query.toString();
      return request(`/procurement/opportunities${qs ? '?' + qs : ''}`);
    },

    async getProcurementOpportunity(keyOrCode) {
      return request(`/procurement/opportunities/${encodeURIComponent(keyOrCode)}`);
    },

    async getProcurementInsights(clusterKey, forceRefresh = false) {
      return request('/procurement/insights', {
        method: 'POST',
        body: { clusterKey, forceRefresh },
      });
    },

    async getProcurementStats() {
      return request('/procurement/stats');
    },

    async getAuditLogs(params = {}) {
      const query = new URLSearchParams();
      if (params.action) query.set('action', params.action);
      if (params.q) query.set('q', params.q);
      if (params.actor) query.set('actor', params.actor);
      if (params.role) query.set('role', params.role);
      if (params.startDate) query.set('startDate', params.startDate);
      if (params.endDate) query.set('endDate', params.endDate);
      if (params.page) query.set('page', String(params.page));
      if (params.limit) query.set('limit', String(params.limit));

      const qs = query.toString();
      return request(`/audit/logs${qs ? '?' + qs : ''}`);
    },

    async getAuditStats() {
      return request('/audit/stats');
    },

    async exportAuditLogs(format = 'csv', params = {}) {
      const query = new URLSearchParams();
      query.set('format', format);
      if (params.action) query.set('action', params.action);
      if (params.q) query.set('q', params.q);

      return request(`/audit/export?${query.toString()}`);
    },
  };

  return API;
});

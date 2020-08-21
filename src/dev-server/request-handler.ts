import type * as d from '../declarations';
import type { IncomingMessage, ServerResponse } from 'http';
import { isDevClient, isDevModule } from './dev-server-utils';
import { normalizePath } from '@utils';
import { serveDevClient } from './serve-dev-client';
import { serveDevNodeModule } from './serve-dev-node-module';
import { serveDirectoryIndex } from './serve-directory-index';
import { serveFile } from './serve-file';
import { ssrRequest } from './ssr-request';
import path from 'path';

export function createRequestHandler(devServerConfig: d.DevServerConfig, serverCtx: d.DevServerContext) {
  return async function (incomingReq: IncomingMessage, res: ServerResponse) {
    try {
      const req = normalizeHttpRequest(devServerConfig, incomingReq);

      if (!req.url) {
        return serverCtx.serve302(req, res);
      }

      if (isDevClient(req.pathname) && devServerConfig.websocket) {
        return serveDevClient(devServerConfig, serverCtx, req, res);
      }

      if (isDevModule(req.pathname)) {
        return serveDevNodeModule(serverCtx, req, res);
      }

      if (!isValidUrlBasePath(devServerConfig.basePath, req.url)) {
        return serverCtx.serve404(
          req,
          res,
          `invalid basePath`,
          `404 File Not Found, base path: ${devServerConfig.basePath}`,
        );
      }

      req.stats = await serverCtx.sys.stat(req.filePath);
      if (req.stats.isFile) {
        return serveFile(devServerConfig, serverCtx, req, res);
      }

      if (req.stats.isDirectory) {
        if (devServerConfig.ssr) {
          return ssrRequest(devServerConfig, serverCtx, req, res);
        }
        return serveDirectoryIndex(devServerConfig, serverCtx, req, res);
      }

      const xSource = ['notfound'];
      const validHistoryApi = isValidHistoryApi(devServerConfig, req);
      xSource.push(`validHistoryApi: ${validHistoryApi}`);

      if (validHistoryApi) {
        try {
          const indexFilePath = path.join(devServerConfig.root, devServerConfig.historyApiFallback.index);
          xSource.push(`indexFilePath: ${indexFilePath}`);

          req.stats = await serverCtx.sys.stat(indexFilePath);
          if (req.stats.isFile) {
            req.filePath = indexFilePath;
            return serveFile(devServerConfig, serverCtx, req, res);
          }
        } catch (e) {
          xSource.push(`notfound error: ${e}`);
        }
      }

      return serverCtx.serve404(req, res, xSource.join(', '));
    } catch (e) {
      return serverCtx.serve500(incomingReq, res, e, `not found error`);
    }
  };
}

export function isValidUrlBasePath(basePath: string, url: URL) {
  // normalize the paths to always end with a slash for the check
  if (!url.pathname.endsWith('/')) {
    url.pathname += '/';
  }
  if (!basePath.endsWith('/')) {
    basePath += '/';
  }
  return url.pathname.startsWith(basePath);
}

function normalizeHttpRequest(devServerConfig: d.DevServerConfig, incomingReq: IncomingMessage) {
  const req: d.HttpRequest = {
    method: (incomingReq.method || 'GET').toUpperCase() as any,
    headers: incomingReq.headers as any,
    acceptHeader:
      (incomingReq.headers && typeof incomingReq.headers.accept === 'string' && incomingReq.headers.accept) || '',
    host: (incomingReq.headers && typeof incomingReq.headers.host === 'string' && incomingReq.headers.host) || null,
    url: null,
    searchParams: null,
  };

  const incomingUrl = (incomingReq.url || '').trim() || null;
  if (incomingUrl) {
    if (req.host) {
      req.url = new URL(incomingReq.url, `http://${req.host}`);
    } else {
      req.url = new URL(incomingReq.url, `http://dev.stenciljs.com`);
    }
    req.searchParams = req.url.searchParams;
  }

  if (req.url) {
    const parts = req.url.pathname.replace(/\\/g, '/').split('/');

    req.pathname = parts.map(part => decodeURIComponent(part)).join('/');
    if (req.pathname.length > 0 && !isDevClient(req.pathname)) {
      req.pathname = '/' + req.pathname.substring(devServerConfig.basePath.length);
    }

    req.filePath = normalizePath(path.normalize(path.join(devServerConfig.root, path.relative('/', req.pathname))));
  }

  return req;
}

export function isValidHistoryApi(devServerConfig: d.DevServerConfig, req: d.HttpRequest) {
  if (!devServerConfig.historyApiFallback) {
    return false;
  }
  if (req.method !== 'GET') {
    return false;
  }
  if (!req.acceptHeader.includes('text/html')) {
    return false;
  }
  if (!devServerConfig.historyApiFallback.disableDotRule && req.pathname.includes('.')) {
    return false;
  }
  return true;
}

import type { RequestOptions } from '@@/plugin-request/request';
import type { RequestConfig } from '@umijs/max';
import { getIntl } from '@umijs/max';
import { message, notification } from 'antd';

// 错误处理方案： 错误类型
enum ErrorShowType {
  SILENT = 0,
  WARN_MESSAGE = 1,
  ERROR_MESSAGE = 2,
  NOTIFICATION = 3,
  REDIRECT = 9,
}
// 与后端约定的响应数据格式（统一响应包装）
interface ResponseStructure {
  code?: number;
  success?: boolean;
  data: unknown;
  message?: string;
  errorCode?: number;
  errorMessage?: string;
  showType?: ErrorShowType;
}

/**
 * @name 错误处理
 * pro 自带的错误处理， 可以在这里做自己的改动
 * @doc https://umijs.org/docs/max/request#配置
 */
export const errorConfig: RequestConfig = {
  // 错误处理： umi@3 的错误处理方案。
  errorConfig: {
    // 错误抛出
    errorThrower: (res) => {
      const { code, success, data, message: msg, errorCode, errorMessage, showType } =
        res as unknown as ResponseStructure;
      // 后端统一响应: code 200 为成功，或 success: true 为成功
      const isSuccess = code === 200 || success === true;
      if (!isSuccess) {
        const error: any = new Error(msg || errorMessage || '请求失败');
        error.name = 'BizError';
        error.info = { errorCode: errorCode || code, errorMessage: msg || errorMessage, showType, data };
        throw error; // 抛出自制的错误
      }
    },
    // 错误接收及处理
    errorHandler: (error: any, opts: any) => {
      if (opts?.skipErrorHandler) throw error;
      // 我们的 errorThrower 抛出的错误。
      if (error.name === 'BizError') {
        const errorInfo: ResponseStructure | undefined = error.info;
        if (errorInfo) {
          const { errorMessage, errorCode } = errorInfo;
          switch (errorInfo.showType) {
            case ErrorShowType.SILENT:
              // do nothing
              break;
            case ErrorShowType.WARN_MESSAGE:
              message.warning(errorMessage);
              break;
            case ErrorShowType.ERROR_MESSAGE:
              message.error(errorMessage);
              break;
            case ErrorShowType.NOTIFICATION:
              notification.open({
                title: errorCode,
                description: errorMessage,
              });
              break;
            case ErrorShowType.REDIRECT:
              window.location.href = '/user/login';
              break;
            default:
              message.error(errorMessage);
          }
        }
      } else if (error.response) {
        // HTTP 状态码错误
        const status = error.response.status;
        if (status === 401) {
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
          window.location.href = '/user/login';
        } else {
          message.error(`请求失败 (${status})`);
        }
      } else if (typeof navigator !== 'undefined' && !navigator.onLine) {
        message.error(
          getIntl().formatMessage({
            id: 'app.request.offline',
            defaultMessage:
              'Network unavailable. Please check your connection and try again.',
          }),
        );
      } else if (error.request) {
        message.error('None response! Please retry.');
      } else {
        message.error('Request error, please retry.');
      }
    },
  },

  // 请求拦截器
  requestInterceptors: [
    (config: RequestOptions) => {
      // 拦截请求配置，进行个性化处理。
      // 示例：为请求附加 token（按需启用）
      // const token = localStorage.getItem('token');
      // if (token) {
      //   config.headers = { ...config.headers, Authorization: `Bearer ${token}` };
      // }
      return config;
    },
  ],

  // 响应拦截器：统一解包后端 {code, data, message} 格式
  responseInterceptors: [
    (response: any) => {
      const { data } = response;
      // 后端统一响应格式: {code:200, data:{...}, message:"success"}
      // 解包后让 authRequest 调用者直接拿到 data 内的内容
      if (data && typeof data === 'object' && 'code' in data && 'data' in data) {
        response.data = data.data;
      }
      return response;
    },
  ],
};

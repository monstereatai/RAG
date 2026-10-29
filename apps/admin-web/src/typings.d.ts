declare module '*.css';
declare module '*.less';
declare module '*.scss';
declare module '*.sass';
declare module '*.svg';
declare module '*.png';
declare module '*.jpg';
declare module '*.jpeg';
declare module '*.gif';
declare module '*.bmp';
declare module '*.tiff';
declare module '*.md' {
  const content: string;
  export default content;
}
declare module 'mockjs';

declare namespace API {
  interface CurrentUser {
    id?: string;
    name?: string;
    username?: string;
    avatar?: string;
    email?: string;
    phone?: string;
    access?: string;
    roles?: string[] | { name: string }[];
    permissions?: string[];
  }
}

declare const __APP_VERSION__: string;
declare const __UMI_VERSION__: string;
declare const __UTOO_VERSION__: string;

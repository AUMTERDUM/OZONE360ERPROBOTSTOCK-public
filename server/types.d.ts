// Fix for @types/express v5 breaking change:
// ParamsDictionary index signature changed from string to string | string[]
// to support wildcard routes (e.g. /foo/*id). Named properties override the
// index signature for specific param names, restoring correct string typing.
declare module 'express-serve-static-core' {
  interface ParamsDictionary {
    id: string;
    token: string;
  }
}

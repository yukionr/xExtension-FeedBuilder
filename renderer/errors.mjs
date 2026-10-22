const messages={
 "service_busy": "The fetch service is busy. Try again.",
 "request_large": "The request is too large",
 "url_invalid": "Invalid URL or wait condition",
 "render_busy": "The renderer is busy. Try again.",
 "render_large": "Rendered HTML exceeds the size limit",
 "charset_unsupported": "Unsupported character encoding",
 "public_url": "Use a public HTTP(S) URL on a standard port",
 "private_address": "Private and reserved addresses are not allowed",
 "redirect_limit": "Too many redirects",
 "response_large": "Response exceeds the size limit",
 "fetch_timeout": "Fetch timed out",
 "upstream_status": "Upstream HTTP %s"
};
export class ServiceError extends Error {
 constructor(code,...args) {
  let i=0;super(messages[code].replace(/%s/g,()=>String(args[i++])));
  this.errorCode=code;this.errorArgs=args;
 }
}
export function errorResponse(error) {
 return {error:error.message,...(error instanceof ServiceError?{errorCode:error.errorCode,errorArgs:error.errorArgs}:{})};
}

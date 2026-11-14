// Test-only ingress for the private ToolsApp service binding.
export default {
  fetch(request: Request, env: { APP: Fetcher }) { return env.APP.fetch(request); },
};

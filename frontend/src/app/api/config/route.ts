export async function GET() {
  return Response.json({
    // Relative — proxied through Next.js rewrites to avoid localhost hard-coding.
    apiBaseUrl: "",
    litellmBaseUrl: "",
  });
}

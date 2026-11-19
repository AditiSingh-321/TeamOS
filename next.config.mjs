/** @type {import('next').NextConfig} */
const config = {
  // Next's dev Server Function logs can include arguments; never log passwords/OTPs.
  logging: {
    serverFunctions: false,
    incomingRequests: { ignore: [/^\/auth\/(recovery|confirm|callback)/, /^\/(forgot-password|verify-reset-code|reset-password|settings\/security)/] },
  },
  async headers() {
    const paths = ["/forgot-password", "/verify-reset-code", "/reset-password", "/auth/recovery", "/auth/confirm", "/settings/:path*"];
    return paths.map(source => ({ source, headers: [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
      { key: "Cache-Control", value: "private, no-store, max-age=0" },
    ] }));
  },
};
export default config;

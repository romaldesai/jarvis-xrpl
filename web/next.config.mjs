/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@xrp2india/agent", "@xrp2india/fallback"],
  serverExternalPackages: ["xrpl", "ethers", "@anthropic-ai/sdk"],
  poweredByHeader: false,
};
export default nextConfig;

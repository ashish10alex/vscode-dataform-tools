let userConfig = undefined
try {
  // try to import ESM first
  userConfig = await import('./v0-user-next.config.mjs')
} catch (e) {
  try {
    // fallback to CJS import
    userConfig = await import("./v0-user-next.config");
  } catch (innerError) {
    // ignore error
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // The FAQ page is gone from the website: a link to it goes to the FAQ in the repository
  async redirects() {
    return [
      {
        source: "/faq",
        destination: "https://github.com/ashish10alex/vscode-dataform-tools/blob/main/FAQ.md",
        permanent: false,
      },
    ];
  },
  allowedDevOrigins: [
    "localhost:3000",
    "127.0.0.1:3000",
    "100.110.67.23:3000",
    "ashishs-macbook-pro:3000",
  ],
  experimental: {
    webpackBuildWorker: true,
    parallelServerBuildTraces: true,
    parallelServerCompiles: true,
  },
}

if (userConfig) {
  // ESM imports will have a "default" property
  const config = userConfig.default || userConfig

  for (const key in config) {
    if (
      typeof nextConfig[key] === 'object' &&
      !Array.isArray(nextConfig[key])
    ) {
      nextConfig[key] = {
        ...nextConfig[key],
        ...config[key],
      }
    } else {
      nextConfig[key] = config[key]
    }
  }
}

export default nextConfig

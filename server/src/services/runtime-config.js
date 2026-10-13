const value = (input) => String(input || "").trim();

export function parseClientOrigins(input) {
  return value(input).split(",").map((item) => item.trim()).filter(Boolean).map((item) => {
    const parsed = new URL(item);
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password
      || parsed.origin !== item.replace(/\/$/, ""))
      throw new Error("CLIENT_ORIGIN must contain only HTTP(S) origins, without credentials, paths or query strings.");
    return parsed.origin;
  });
}

export function isProductionRuntime(env = process.env) {
  return env.NODE_ENV === "production"
    || ["RENDER", "NETLIFY", "VERCEL", "AWS_LAMBDA_FUNCTION_NAME"]
      .some((key) => Boolean(value(env[key])));
}

export function validateRuntimeConfiguration(env = process.env) {
  if (!isProductionRuntime(env)) return;
  if (!value(env.MONGODB_URI))
    throw new Error("Production requires MONGODB_URI. Refusing to use temporary local JSON storage.");
  if (value(env.AUTH_SECRET).length < 32)
    throw new Error("Production requires AUTH_SECRET with at least 32 characters.");
  if (!value(env.CLIENT_ORIGIN))
    throw new Error("Production requires CLIENT_ORIGIN (for example https://scratch.justconnect.biz).");
  try {
    parseClientOrigins(env.CLIENT_ORIGIN);
  } catch {
    throw new Error("CLIENT_ORIGIN must contain only HTTP(S) origins, without credentials, paths or query strings.");
  }
}

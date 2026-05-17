type ViteEnv = {
  DEV?: boolean;
  VITE_ENABLE_LOCAL_REFRESH?: string;
  VITE_PUBLIC_READ_ONLY?: string;
};

function env(): ViteEnv {
  return (import.meta as unknown as { env?: ViteEnv }).env ?? {};
}

export function isPublicReadOnlyMode(): boolean {
  const value = env().VITE_PUBLIC_READ_ONLY;
  if (value === undefined) return !env().DEV;
  return ["1", "true", "yes"].includes(value.toLowerCase());
}

export function isLocalRefreshEnabled(): boolean {
  if (isPublicReadOnlyMode()) return false;
  const value = env().VITE_ENABLE_LOCAL_REFRESH;
  if (value === undefined) return Boolean(env().DEV);
  return ["1", "true", "yes"].includes(value.toLowerCase());
}

export interface MacDownloads {
  appleSilicon: string | null;
  intel: string | null;
}

/** Match this project's electron-builder DMG names, never guess from browser UA. */
export function pickMacDownloads(
  assets: { name: string; browser_download_url: string }[],
): MacDownloads {
  const dmgs = assets.filter((asset) => /\.dmg$/i.test(asset.name));
  const universal = dmgs.find((asset) => /[-.]universal\.dmg$/i.test(asset.name));
  const arm = dmgs.find((asset) => /[-.](arm64|aarch64)\.dmg$/i.test(asset.name));
  const intel = dmgs.find((asset) => /[-.](x64|x86_64)\.dmg$/i.test(asset.name))
    // electron-builder omits the architecture suffix for the default x64 build.
    ?? dmgs.find((asset) => /^Agent[. -]Pulse-\d+\.\d+\.\d+\.dmg$/i.test(asset.name));
  return {
    appleSilicon: (universal ?? arm)?.browser_download_url ?? null,
    intel: (universal ?? intel)?.browser_download_url ?? null,
  };
}

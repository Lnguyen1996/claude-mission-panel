import screenshot from "screenshot-desktop";

export async function captureScreen(): Promise<string> {
  const img = await screenshot({ format: "png" });
  return (img as Buffer).toString("base64");
}

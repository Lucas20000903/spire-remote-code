export function ImageBlock({
  source,
}: {
  source: { type: string; media_type: string; data: string }
}) {
  const src = `data:${source.media_type};base64,${source.data}`
  return <img src={src} className="max-w-full rounded" alt="" />
}

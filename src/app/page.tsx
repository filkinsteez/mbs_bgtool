import { Tool } from '@/tool/Tool'

// The query is parsed inside the client component. Importing the engine here would put it and every
// recipe in this server component's graph; in dev each edit to them then refreshes open pages, and a
// refresh that arrives while the page hydrates makes React warn about an update before mount.
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return <Tool searchParams={await searchParams} />
}

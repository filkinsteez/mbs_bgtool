import { Tool } from '@/tool/Tool'
import { parseQuery } from '@/tool/state'

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return <Tool initial={parseQuery(await searchParams)} />
}

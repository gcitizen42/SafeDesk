import { Link } from 'wouter'

export function NotFound() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-2 px-4 py-8">
      <h1 className="text-xl font-semibold">Not found</h1>
      <Link href="/" className="text-sm underline underline-offset-4">
        Home
      </Link>
    </div>
  )
}

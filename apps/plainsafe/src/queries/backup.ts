// Back up and Restore (SPEC §9.5): the user-data stores as one JSON file.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { run } from '@/effect/run'
import {
  applyRestore,
  backupFileName,
  makeBackup,
  type RestorePlan,
} from '@/features/backup/backup'
import { downloadJson } from '@/lib/download'

/** Downloads the backup file; resolves to how many invalid records were left out. */
export function useBackup() {
  return useMutation({
    mutationFn: async () => {
      const { file, skipped } = await run(makeBackup)
      downloadJson(backupFileName(file.createdAt), file)
      return { skipped }
    },
  })
}

/** Writes a checked plan, then reads everything again: settings and all that depends on them. */
export function useRestore() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (plan: RestorePlan) => {
      await run(applyRestore(plan))
      await queryClient.invalidateQueries()
    },
  })
}

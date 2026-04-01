import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { fetchProjects } from '@/lib/api'

interface NewSessionProps {
  onSelect: (cwd: string) => void
}

interface Project {
  name: string
  path: string
}

export function NewSession({ onSelect }: NewSessionProps) {
  const [open, setOpen] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    fetchProjects()
      .then((data: Project[]) => setProjects(data))
      .catch(() => setProjects([]))
      .finally(() => setLoading(false))
  }, [open])

  const handleSelect = (cwd: string) => {
    onSelect(cwd)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="w-full" variant="outline">
          + New Session
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Select Project</DialogTitle>
        </DialogHeader>
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {loading && (
            <p className="text-sm text-muted-foreground">Loading projects...</p>
          )}
          {!loading && projects.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No projects found.
            </p>
          )}
          {projects.map((p) => (
            <button
              key={p.path}
              onClick={() => handleSelect(p.path)}
              className="w-full rounded-md border p-3 text-left transition-colors hover:bg-accent"
            >
              <div className="font-medium">{p.name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {p.path}
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

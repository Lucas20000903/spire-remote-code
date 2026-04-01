import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useSettings } from '@/hooks/use-settings'
import { requestPermission } from '@/lib/notifications'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { settings, updateSetting } = useSettings()

  const handleNotificationToggle = async () => {
    if (!settings.notificationsEnabled) {
      const granted = await requestPermission()
      if (granted) {
        updateSetting('notificationsEnabled', true)
      }
    } else {
      updateSetting('notificationsEnabled', false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Notifications</div>
              <div className="text-xs text-muted-foreground">Get notified when tasks complete</div>
            </div>
            <button
              onClick={handleNotificationToggle}
              className={`relative h-6 w-11 rounded-full transition-colors ${
                settings.notificationsEnabled ? 'bg-green-500' : 'bg-muted'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                  settings.notificationsEnabled ? 'translate-x-5' : ''
                }`}
              />
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

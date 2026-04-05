import { useState, useMemo } from 'react'
import { TaskListBlock } from './blocks/task-list-block'
import { PermissionCard } from './permission-card'
import { ChatInput } from './chat-input'
import { ChevronRight, FileText, Terminal, Search, Pencil, FolderOpen, Check, Loader2, X } from 'lucide-react'
import hljs from 'highlight.js/lib/core'
import typescript from 'highlight.js/lib/languages/typescript'
import java from 'highlight.js/lib/languages/java'
import bash from 'highlight.js/lib/languages/bash'
import json from 'highlight.js/lib/languages/json'
import 'highlight.js/styles/github-dark.css'

hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('java', java)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('json', json)
import { cn } from '@/lib/utils'
import type { TaskItem } from '@/lib/types'

const mockTasks: TaskItem[] = [
  { id: 1, subject: '프로젝트 컨텍스트 탐색', description: '', status: 'completed' },
  { id: 2, subject: 'API 엔드포인트 설계', description: '', status: 'completed' },
  { id: 3, subject: '데이터베이스 스키마 작성', description: '', status: 'completed' },
  { id: 4, subject: 'Store 및 타입 정리', description: '', status: 'in_progress' },
  { id: 5, subject: 'RegionSettingsModal 리팩토링', description: '', status: 'open' },
  { id: 6, subject: 'RegionLoadModal 생성', description: '', status: 'open' },
  { id: 7, subject: '사이드바 UI 변경', description: '', status: 'open' },
  { id: 8, subject: '기존 코드 정리 및 테스트', description: '', status: 'open' },
]

// --- Tool Use 블록 컴포넌트들 ---

function ToolIcon({ name }: { name: string }) {
  switch (name) {
    case 'Read': return <FileText className="h-3.5 w-3.5" />
    case 'Write': return <FileText className="h-3.5 w-3.5" />
    case 'Edit': return <Pencil className="h-3.5 w-3.5" />
    case 'Bash': return <Terminal className="h-3.5 w-3.5" />
    case 'Grep': return <Search className="h-3.5 w-3.5" />
    case 'Glob': return <FolderOpen className="h-3.5 w-3.5" />
    default: return <FileText className="h-3.5 w-3.5" />
  }
}

function ToolStatusIcon({ status }: { status: 'running' | 'done' | 'error' }) {
  switch (status) {
    case 'done': return <Check className="h-3.5 w-3.5 text-emerald-500" />
    case 'running': return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
    case 'error': return <X className="h-3.5 w-3.5 text-red-400" />
  }
}

interface MockToolBlockProps {
  name: string
  label: string
  status: 'running' | 'done' | 'error'
  children?: React.ReactNode
}

function MockToolBlock({ name, label, status, children }: MockToolBlockProps) {
  const [open, setOpen] = useState(false)
  const hasContent = !!children

  return (
    <div className="rounded-lg border border-border/50 bg-muted/10 overflow-hidden">
      <button
        onClick={() => hasContent && setOpen(!open)}
        className={cn(
          'flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors',
          hasContent && 'hover:bg-muted/20 cursor-pointer',
        )}
      >
        {hasContent && (
          <ChevronRight className={cn('h-3 w-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
        )}
        <span className={cn(
          'rounded px-1.5 py-0.5 font-mono',
          name === 'Edit' && 'bg-amber-500/10 text-amber-400',
          name === 'Bash' && 'bg-violet-500/10 text-violet-400',
          name === 'Read' && 'bg-blue-500/10 text-blue-400',
          name === 'Write' && 'bg-emerald-500/10 text-emerald-400',
          name === 'Grep' && 'bg-cyan-500/10 text-cyan-400',
          name === 'Glob' && 'bg-pink-500/10 text-pink-400',
        )}>
          <ToolIcon name={name} />
        </span>
        <span className="truncate text-muted-foreground">{label}</span>
        <span className="ml-auto shrink-0">
          <ToolStatusIcon status={status} />
        </span>
      </button>
      {open && children && (
        <div className="border-t border-border/30">
          {children}
        </div>
      )}
    </div>
  )
}

// --- Diff 뷰 (하이라이팅 포함) ---
function DiffView({ oldStr, newStr, lang = 'typescript' }: { oldStr: string; newStr: string; lang?: string }) {
  const oldHighlighted = useMemo(() => {
    try { return hljs.highlight(oldStr, { language: lang }).value } catch { return oldStr }
  }, [oldStr, lang])
  const newHighlighted = useMemo(() => {
    try { return hljs.highlight(newStr, { language: lang }).value } catch { return newStr }
  }, [newStr, lang])

  return (
    <div className="overflow-x-auto font-mono text-xs leading-relaxed">
      {oldHighlighted.split('\n').map((line, i) => (
        <div key={`o${i}`} className="bg-red-500/8 px-3 py-0.5 flex">
          <span className="inline-block w-5 text-right mr-2 text-red-400/40 select-none shrink-0">-</span>
          <span className="text-red-400/90" dangerouslySetInnerHTML={{ __html: line || '&nbsp;' }} />
        </div>
      ))}
      {newHighlighted.split('\n').map((line, i) => (
        <div key={`n${i}`} className="bg-emerald-500/8 px-3 py-0.5 flex">
          <span className="inline-block w-5 text-right mr-2 text-emerald-400/40 select-none shrink-0">+</span>
          <span className="text-emerald-400/90" dangerouslySetInnerHTML={{ __html: line || '&nbsp;' }} />
        </div>
      ))}
    </div>
  )
}

// --- 코드 미리보기 (highlight.js) ---
function CodePreview({ code, lang = 'typescript', maxLines = 12 }: { code: string; lang?: string; maxLines?: number }) {
  const lines = code.split('\n')
  const truncated = lines.length > maxLines
  const displayCode = truncated ? lines.slice(0, maxLines).join('\n') : code

  const highlighted = useMemo(() => {
    try {
      return hljs.highlight(displayCode, { language: lang }).value
    } catch {
      return displayCode
    }
  }, [displayCode, lang])

  return (
    <div className="overflow-x-auto">
      <pre className="px-3 py-2 text-xs font-mono leading-relaxed">
        <code dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
      {truncated && (
        <div className="px-3 py-1 text-[11px] text-muted-foreground border-t border-border/20">
          {lines.length} lines total
        </div>
      )}
    </div>
  )
}

// --- Bash 출력 ---
function BashOutput({ command, output, isError }: { command: string; output: string; isError?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <div className="px-3 py-1.5 border-b border-border/20">
        <span className="font-mono text-xs text-violet-400">$ {command}</span>
      </div>
      <pre className={cn('px-3 py-2 text-xs font-mono leading-relaxed', isError ? 'text-red-400' : 'text-foreground/80')}>
        {output}
      </pre>
    </div>
  )
}

// --- Grep 결과 ---
function GrepResults({ pattern, results }: { pattern: string; results: string[] }) {
  return (
    <div className="overflow-x-auto">
      <div className="px-3 py-1.5 border-b border-border/20 text-xs">
        <span className="text-muted-foreground">Pattern:</span>{' '}
        <span className="font-mono text-cyan-400">{pattern}</span>
        <span className="ml-2 text-muted-foreground">({results.length} matches)</span>
      </div>
      <div className="px-3 py-1.5 space-y-0.5">
        {results.map((r, i) => (
          <div key={i} className="text-xs font-mono text-foreground/80 truncate">{r}</div>
        ))}
      </div>
    </div>
  )
}

// --- Tool 그룹 (여러 tool call 묶음, 펼칠 수 있는) ---
function MockToolGroup() {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg border border-border/50 bg-muted/10 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted/20 cursor-pointer"
      >
        <ChevronRight className={cn('h-3 w-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
        <span className="text-muted-foreground">3 tool calls</span>
        <div className="flex items-center gap-1">
          <span className="rounded bg-blue-500/10 px-1.5 py-0.5 font-mono text-[10px] text-blue-400">Read</span>
          <span className="rounded bg-blue-500/10 px-1.5 py-0.5 font-mono text-[10px] text-blue-400">Read</span>
          <span className="rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-400">Edit</span>
        </div>
        <span className="ml-auto"><Check className="h-3.5 w-3.5 text-emerald-500" /></span>
      </button>
      {open && (
        <div className="border-t border-border/30 p-2 space-y-1.5">
          <MockToolBlock name="Read" label="src/types/region.ts" status="done">
            <CodePreview lang="typescript" code={`export interface RegionConfig {
  id: string
  name: string
  districts: RegionDistrictDto[]
  createdAt: string
}

export interface RegionDistrictDto {
  regionCode: string
  districtCode: string
  displayName: string
}`} />
          </MockToolBlock>
          <MockToolBlock name="Read" label="src/api/regionApi.ts" status="done">
            <CodePreview lang="typescript" code={`import { api } from './client'
import type { RegionConfig, CreateRegionConfigRequest } from '@/types'

export const regionApi = {
  getAll: () => api.get<RegionConfig[]>('/regions/configs'),
  create: (req: CreateRegionConfigRequest) => api.post<RegionConfig>('/regions/configs', req),
  delete: (id: string) => api.delete(\`/regions/configs/\${id}\`),
}`} />
          </MockToolBlock>
          <MockToolBlock name="Edit" label="src/stores/regionStore.ts" status="done">
            <DiffView
              oldStr={`import { getSavedScenarios, saveScenarios } from '@/utils/localStorage'`}
              newStr={`import { regionApi } from '@/api/regionApi'`}
            />
          </MockToolBlock>
        </div>
      )}
    </div>
  )
}

const mockMessages = [
  { role: 'user', content: '권역 설정 기능을 서버 저장 방식으로 변경해줘' },
  { role: 'assistant', content: '네, 권역 설정을 서버에 저장하도록 변경하겠습니다. 먼저 현재 구조를 파악하겠습니다.' },
]

export function MockPreview() {
  return (
    <div className="relative flex h-full flex-col bg-background">
      {/* 헤더 */}
      <div className="shrink-0 border-b border-border/30 px-4 py-3">
        <h2 className="text-sm font-medium">UI Mock Preview</h2>
        <p className="text-xs text-muted-foreground">모든 UI 요소 스타일 테스트</p>
      </div>

      {/* 채팅 영역 */}
      <div className="flex-1 overflow-auto px-4 pt-4" style={{ paddingBottom: 400 }}>
        <div className="mx-auto max-w-2xl space-y-4">

          {/* 유저 메시지 */}
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl bg-secondary px-4 py-2.5">
              <p className="text-sm text-secondary-foreground">{mockMessages[0].content}</p>
            </div>
          </div>

          {/* 어시스턴트 메시지 */}
          <div>
            <p className="text-sm text-foreground">{mockMessages[1].content}</p>
          </div>

          {/* Thinking */}
          <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <span className="text-foreground font-medium">12s</span>
            <span>동안 생각함</span>
          </div>

          {/* --- Tool Use 블록들 --- */}

          {/* Read — 완료, 펼치면 코드 미리보기 */}
          <MockToolBlock name="Read" label="src/stores/regionStore.ts" status="done">
            <CodePreview code={`import { defineStore } from 'pinia'
import type { RegionConfig, RegionDistrictDto } from '@/types'

export const useRegionStore = defineStore('region', {
  state: () => ({
    configs: [] as RegionConfig[],
    currentConfigId: null as string | null,
    loading: false,
  }),
  actions: {
    async loadConfigs() {
      this.loading = true
      const { data } = await api.get('/regions/configs')
      this.configs = data
      this.loading = false
    },
  },
})`} />
          </MockToolBlock>

          {/* Grep — 완료 */}
          <MockToolBlock name="Grep" label="localStorage.*region" status="done">
            <GrepResults
              pattern="localStorage.*region"
              results={[
                'src/stores/regionStore.ts:42: localStorage.setItem("savedScenarios", JSON.stringify(scenarios))',
                'src/stores/regionStore.ts:58: const saved = localStorage.getItem("savedScenarios")',
                'src/components/RegionSettings.vue:112: localStorage.removeItem("savedScenarios")',
              ]}
            />
          </MockToolBlock>

          <div>
            <p className="text-sm text-foreground">localStorage 사용처를 확인했습니다. 3곳에서 사용 중이네요. 이제 수정하겠습니다.</p>
          </div>

          {/* Edit — 완료, 펼치면 diff */}
          <MockToolBlock name="Edit" label="src/stores/regionStore.ts" status="done">
            <DiffView
              oldStr={`    async saveScenario(name: string) {
      const scenarios = this.getSavedScenarios()
      scenarios.push({ name, config: this.currentConfig })
      localStorage.setItem("savedScenarios", JSON.stringify(scenarios))
    },`}
              newStr={`    async saveConfig(name: string) {
      const { data } = await api.post('/regions/configs', {
        name,
        config: this.currentConfig,
      })
      this.configs.push(data)
      this.currentConfigId = data.id
    },`}
            />
          </MockToolBlock>

          {/* Edit — 완료 */}
          <MockToolBlock name="Edit" label="src/components/RegionSettings.vue" status="done">
            <DiffView
              oldStr={`    localStorage.removeItem("savedScenarios")`}
              newStr={`    await api.delete(\`/regions/configs/\${configId}\`)
    regionStore.configs = regionStore.configs.filter(c => c.id !== configId)`}
            />
          </MockToolBlock>

          {/* Write — 완료 */}
          <MockToolBlock name="Write" label="src/utils/regionMapping.ts" status="done">
            <CodePreview code={`export function areaIdToDistrict(areaId: string): RegionDistrictDto {
  const [region, district] = areaId.split('-')
  return { regionCode: region, districtCode: district }
}

export function districtToAreaId(dto: RegionDistrictDto): string {
  return \`\${dto.regionCode}-\${dto.districtCode}\`
}`} />
          </MockToolBlock>

          {/* Bash — 실행 중 */}
          <MockToolBlock name="Bash" label="pnpm tsc --noEmit" status="running">
            <BashOutput
              command="pnpm tsc --noEmit"
              output="Checking types..."
            />
          </MockToolBlock>

          {/* Bash — 에러 */}
          <MockToolBlock name="Bash" label="pnpm test -- regionStore" status="error">
            <BashOutput
              command="pnpm test -- regionStore"
              output={`FAIL src/stores/__tests__/regionStore.test.ts
  ● useRegionStore › saveConfig › should call API

    TypeError: api.post is not a function

      44 |     async saveConfig(name: string) {
    > 45 |       const { data } = await api.post('/regions/configs', {
         |                                  ^
      46 |         name,`}
              isError
            />
          </MockToolBlock>

          {/* Glob — 완료 */}
          <MockToolBlock name="Glob" label="**/*region*" status="done">
            <GrepResults
              pattern="**/*region*"
              results={[
                'src/stores/regionStore.ts',
                'src/components/RegionSettings.vue',
                'src/components/RegionLoadModal.vue',
                'src/utils/regionMapping.ts',
                'src/types/region.ts',
              ]}
            />
          </MockToolBlock>

          {/* Tool use 그룹 (펼칠 수 있는) */}
          <MockToolGroup />

          {/* Java 파일 Read */}
          <MockToolBlock name="Read" label="src/main/java/com/example/RegionService.java" status="done">
            <CodePreview lang="java" code={`@Service
@RequiredArgsConstructor
public class RegionService {

    private final RegionRepository regionRepository;
    private final RegionMapper regionMapper;

    @Transactional(readOnly = true)
    public List<RegionConfigDto> getAllConfigs() {
        return regionRepository.findAll().stream()
            .map(regionMapper::toDto)
            .collect(Collectors.toList());
    }

    @Transactional
    public RegionConfigDto saveConfig(CreateRegionConfigRequest request) {
        RegionConfig entity = regionMapper.toEntity(request);
        RegionConfig saved = regionRepository.save(entity);
        return regionMapper.toDto(saved);
    }

    @Transactional
    public void deleteConfig(Long id) {
        regionRepository.deleteById(id);
    }
}`} />
          </MockToolBlock>

          {/* Java Edit */}
          <MockToolBlock name="Edit" label="src/main/java/com/example/RegionController.java" status="done">
            <DiffView lang="java"
              oldStr={`    @GetMapping("/regions")
    public ResponseEntity<List<RegionConfig>> getAll() {
        return ResponseEntity.ok(regionService.getAll());
    }`}
              newStr={`    @GetMapping("/regions/configs")
    public ResponseEntity<List<RegionConfigDto>> getAllConfigs() {
        return ResponseEntity.ok(regionService.getAllConfigs());
    }

    @PostMapping("/regions/configs")
    public ResponseEntity<RegionConfigDto> saveConfig(
            @RequestBody @Valid CreateRegionConfigRequest request) {
        return ResponseEntity.ok(regionService.saveConfig(request));
    }`}
            />
          </MockToolBlock>

          {/* 어시스턴트 응답 */}
          <div>
            <p className="text-sm text-foreground">localStorage 기반 코드를 서버 API 호출로 전환했습니다. 타입 체크에서 에러가 발생해서 수정 중입니다.</p>
          </div>

          {/* Typing indicator */}
          <div className="flex items-center gap-1.5 py-2">
            <div className="flex gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        </div>
      </div>

      {/* === 입력 위 요소들 === */}
      <div className="absolute bottom-0 left-0 right-0 z-10">
        {/* Task 체크리스트 */}
        <div className="px-3 py-2">
          <TaskListBlock tasks={mockTasks} />
        </div>

        {/* Permission 카드 */}
        <PermissionCard
          requestId="mock-1"
          toolName="Bash"
          description="pnpm tsc --noEmit 실행"
          inputPreview='{"command": "pnpm tsc --noEmit"}'
          onRespond={() => {}}
        />

        {/* MCP 미연결 배너 */}
        <div className="px-3 py-2">
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-center text-xs text-yellow-500">
            MCP 미연결 — 메시지를 보내려면 Claude Code에서 채널을 재연결하세요
          </div>
        </div>

        {/* ChatInput */}
        <ChatInput disabled={false} onSend={() => {}} />
      </div>
    </div>
  )
}

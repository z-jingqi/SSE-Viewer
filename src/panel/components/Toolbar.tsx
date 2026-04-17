import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Separator } from "./ui/separator"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu"
import {
  ChevronDown,
  Circle,
  Download,
  Filter,
  Trash2,
  Wrench,
} from "lucide-react"
import { cn } from "@/panel/lib/utils"

interface ToolbarProps {
  paused: boolean
  onTogglePause: () => void
  onClear: () => void
  onExport: () => void
  urlFilter: string
  onUrlFilterChange: (v: string) => void
  search: string
  onSearchChange: (v: string) => void
  availableTypes: string[]
  selectedTypes: Set<string>
  onToggleType: (t: string) => void
  onClearTypes: () => void
  availableTools: string[]
  selectedTools: Set<string>
  onToggleTool: (t: string) => void
  onClearTools: () => void
  onlyWithTools: boolean
  onToggleOnlyWithTools: () => void
  streamCount: number
  eventCount: number
}

export function Toolbar({
  paused,
  onTogglePause,
  onClear,
  onExport,
  urlFilter,
  onUrlFilterChange,
  search,
  onSearchChange,
  availableTypes,
  selectedTypes,
  onToggleType,
  onClearTypes,
  availableTools,
  selectedTools,
  onToggleTool,
  onClearTools,
  onlyWithTools,
  onToggleOnlyWithTools,
  streamCount,
  eventCount,
}: ToolbarProps) {
  const typeButtonLabel =
    selectedTypes.size === 0
      ? "Type: all"
      : selectedTypes.size === 1
        ? `Type: ${Array.from(selectedTypes)[0]}`
        : `Type: ${selectedTypes.size} selected`
  const toolButtonLabel =
    selectedTools.size === 0
      ? onlyWithTools
        ? "Tool: any"
        : "Tool: all"
      : selectedTools.size === 1
        ? `Tool: ${Array.from(selectedTools)[0]}`
        : `Tool: ${selectedTools.size} selected`
  const toolFilterActive = onlyWithTools || selectedTools.size > 0

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 border-b border-border bg-card">
      <Button
        variant="ghost"
        size="icon"
        onClick={onTogglePause}
        title={paused ? "Resume capture" : "Pause capture"}
      >
        {paused ? (
          <Circle className={cn("text-muted-foreground")} />
        ) : (
          <Circle className="fill-destructive text-destructive" />
        )}
      </Button>
      <Button variant="ghost" size="icon" onClick={onClear} title="Clear">
        <Trash2 />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={onExport}
        title="Export JSON"
      >
        <Download />
      </Button>

      <Separator orientation="vertical" className="h-5 mx-1" />

      <Input
        placeholder="Filter streams by URL…"
        value={urlFilter}
        onChange={(e) => onUrlFilterChange(e.target.value)}
        className="h-6 max-w-56"
      />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="default"
            className={cn(
              "h-6 gap-1 font-normal",
              selectedTypes.size > 0 && "border-primary/40 text-primary"
            )}
            disabled={availableTypes.length === 0}
            title="Filter by event type"
          >
            <Filter className="size-3" />
            <span className="text-[11px]">{typeButtonLabel}</span>
            <ChevronDown className="size-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[14rem]">
          <DropdownMenuLabel>Event types</DropdownMenuLabel>
          {availableTypes.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              No types yet
            </div>
          ) : (
            availableTypes.map((t) => (
              <DropdownMenuCheckboxItem
                key={t}
                checked={selectedTypes.has(t)}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={() => onToggleType(t)}
              >
                <span className="font-mono">{t}</span>
              </DropdownMenuCheckboxItem>
            ))
          )}
          {selectedTypes.size > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onClearTypes}>
                Clear selection
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="default"
            className={cn(
              "h-6 gap-1 font-normal",
              toolFilterActive && "border-primary/40 text-primary"
            )}
            title="Filter by tool call"
          >
            <Wrench className="size-3" />
            <span className="text-[11px]">{toolButtonLabel}</span>
            <ChevronDown className="size-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[14rem]">
          <DropdownMenuLabel>Tool calls</DropdownMenuLabel>
          <DropdownMenuCheckboxItem
            checked={onlyWithTools}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={onToggleOnlyWithTools}
          >
            <span className="italic">Only events with tool calls</span>
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>By name</DropdownMenuLabel>
          {availableTools.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              No tool calls detected
            </div>
          ) : (
            availableTools.map((t) => (
              <DropdownMenuCheckboxItem
                key={t}
                checked={selectedTools.has(t)}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={() => onToggleTool(t)}
              >
                <span className="font-mono">{t}</span>
              </DropdownMenuCheckboxItem>
            ))
          )}
          {(selectedTools.size > 0 || onlyWithTools) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onClearTools}>
                Clear selection
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Input
        placeholder="Search payloads…"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        className="h-6 max-w-56"
      />

      <div className="ml-auto text-[11px] text-muted-foreground tabular-nums">
        {streamCount} stream{streamCount === 1 ? "" : "s"} · {eventCount} event
        {eventCount === 1 ? "" : "s"}
      </div>
    </div>
  )
}

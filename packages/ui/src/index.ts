// --- Utilities ---
export { cn } from "./lib/cn";

// --- Primitives (shadcn-style) ---
export { Button, buttonVariants, type ButtonProps } from "./components/Button";
export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "./components/Card";
export { Input, Textarea, type InputProps, type TextareaProps } from "./components/Input";
export { Label } from "./components/Label";
export { Badge, type BadgeProps } from "./components/Badge";
export { Switch } from "./components/Switch";
export { Separator } from "./components/Separator";
export { Skeleton } from "./components/Skeleton";
export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogClose,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "./components/Dialog";
export {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverAnchor,
} from "./components/Popover";
export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from "./components/Select";
export {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "./components/Tabs";
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  DropdownMenuPortal,
} from "./components/DropdownMenu";
export {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "./components/Accordion";
export {
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
} from "./components/Toast";

// --- Opa-proof domain components (plan §3.3) ---
export {
  SimpleMetric,
  type MetricTone,
  type SimpleMetricProps,
} from "./components/SimpleMetric";
export { ExplainerPopover } from "./components/ExplainerPopover";
export { PrimaryAction } from "./components/PrimaryAction";
export { DetailToggle, type UiMode } from "./components/DetailToggle";
export { TrafficLightCard } from "./components/TrafficLightCard";
export { ProgressGoal } from "./components/ProgressGoal";
export { EmptyState } from "./components/EmptyState";
export { StatusPill } from "./components/StatusPill";
export { Sparkline, type SparklineProps, type SparklineTone } from "./components/Sparkline";
export {
  MetricTile,
  type MetricTileProps,
  type MetricTileTone,
  type MetricDeltaInput,
} from "./components/MetricTile";

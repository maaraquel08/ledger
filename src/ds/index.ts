/**
 * Ledger design-system entry. Everything a design built with Ledger's parts needs:
 * the root wrapper, the Ledger primitives, chrome, the Add sheet, the icon set,
 * and the sc1m registry components the app composes with.
 */
export { LedgerDesignSystem } from "./provider";

export {
  Screen,
  BackBar,
  PageTitle,
  Eyebrow,
  AiEyebrow,
  Amount,
  ProviderMark,
  CategoryChip,
  EntryRow,
  Pill,
  Cta,
  ActionButton,
  Segmented,
  Sheet,
  StatGrid,
  Delta,
  AiPanel,
  AiCard,
  AiMark,
} from "@/components/ledger/primitives";
export { TabBar, ChromeProvider, useChrome } from "@/components/ledger/chrome";
export { AddSheet } from "@/components/ledger/add-sheet";
export * from "@/components/ledger/icons";

export { AiSummary, AiSummaryLabel, AiSummaryText, AiSummaryMark, aiSummaryPalettes } from "@/components/ui/ai-summary/ai-summary";
export type { AiSummaryPalette } from "@/components/ui/ai-summary/ai-summary";
export { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar/avatar";
export { Badge } from "@/components/ui/badge/badge";
export type { BadgeProps } from "@/components/ui/badge/badge";
export { Banner } from "@/components/ui/banner/banner";
export type { BannerProps } from "@/components/ui/banner/banner";
export { Button } from "@/components/ui/button/button";
export type { ButtonProps } from "@/components/ui/button/button";
export { Drawer, DrawerTrigger, DrawerContent, DrawerTitle, DrawerDescription, DrawerClose } from "@/components/ui/drawer/drawer";
export { Input } from "@/components/ui/input/input";
export { Progress, ProgressTrack, ProgressIndicator, ProgressLabel, ProgressValue } from "@/components/ui/progress/progress";
export { Tabs, TabsList, TabsTab, TabsPanel } from "@/components/ui/tabs/tabs";
export { Toggle } from "@/components/ui/toggle/toggle";
export { Switch } from "@/components/ui/switch/switch";
export { ToggleGroup } from "@/components/ui/toggle-group/toggle-group";

export { LedgerProvider, useLedger, useOnline, newId } from "@/lib/store";
export { peso, signed, balance, compact, kilo, pct, goalLabel } from "@/lib/format";
export { PROVIDERS, SPEND_CATEGORIES, TYPE_LABEL } from "@/lib/providers";
export type { Account, Entry, Category, Provider, Goal, Profile, LedgerState } from "@/lib/types";

import { type Bot, type Chest, type Player } from "mineflayer";
import { type Vec3 } from "vec3";

import { type Logger } from "./logger";
import { type World } from "./worlds/types";

type FlatRect = {
  x: [number, number];
  y: number;
  z: [number, number];
};

type Point3D = [number, number, number];

type Range3D = [[number, number], [number, number], [number, number]];

enum GoalName {
  ComeHere = "come-here",
  DigRange = "dig-range",
  Eat = "eat",
  Follow = "follow",
  ManageFarm = "manage-farm",
  MonitorChest = "monitor-chest",
  ReportPosition = "report-position",
  Unknown = "unknown",
}

type ChestType = "digging" | "farm";

type CropType = "trees" | "wheat";

/**
 * For example, +x means: keep z the same, increment x
 */
type Direction = "-x" | "-z" | "+x" | "+z";

type Goal =
  | {
      name: GoalName.ComeHere;
      opts: { target: Vec3 };
    }
  | {
      name: GoalName.ManageFarm;
      opts: {
        currentTask: [CropType, number] | null;
        farmIndex: number;
        isGoing: boolean;
        lastXChecked: null | number;
      };
    }
  | {
      name: GoalName.MonitorChest;
      opts: {
        chest: Chest | null;
        chestIndex: number;
        chestType: ChestType;
        isGoing: boolean;
      };
    }
  | Exclude<
      GoalName,
      GoalName.ComeHere | GoalName.ManageFarm | GoalName.MonitorChest
    >;

const createMonitorChestGoal = (
  chestIndex: number,
  chestType: ChestType,
): Goal => ({
  name: GoalName.MonitorChest,
  opts: { chest: null, chestIndex, chestType, isGoing: false },
});

const createFarmGoal = (
  farmIndex: number,
  cropType: CropType,
  cropIndex = 0,
): Goal => ({
  name: GoalName.ManageFarm,
  opts: {
    currentTask: [cropType, cropIndex],
    farmIndex,
    isGoing: false,
    lastXChecked: null,
  },
});

const goalAliases: Record<string, Goal> = {
  cd0: createMonitorChestGoal(0, "digging"),
  cd1: createMonitorChestGoal(1, "digging"),
  cf0: createMonitorChestGoal(0, "farm"),
  cf1: createMonitorChestGoal(1, "farm"),
  ft0: createFarmGoal(0, "trees"),
  fw0: createFarmGoal(0, "wheat"),
};

enum LogLevel {
  Debug = "debug",
  Error = "error",
  Fatal = "fatal",
  Info = "info",
  Silly = "silly",
  Warn = "warn",
}

const logLevels: LogLevel[] = [
  LogLevel.Silly,
  LogLevel.Debug,
  LogLevel.Info,
  LogLevel.Warn,
  LogLevel.Error,
  LogLevel.Fatal,
];

type BotState = {
  addTorches: boolean;
  allowDigWithHand: boolean;
  bot: Bot;
  constantGoal: Goal | null;
  currentGoal: Goal | null;
  focusRange: null | Range3D;
  followTarget: null | Player["entity"];
  initialBlock: [number, number, number] | null;
  logLevel: LogLevel;
  world: World;
};

type Context = [BotState, UpdateEvent[]];

enum ChatCommand {
  Attack = "attack",
  ClosestEntity = "closest-entity",
  ComeHere = "come-here",
  Commands = "commands",
  DigInfo = "dig-info",
  DigRange = "dig-r",
  DigRangeHere = "dig-r-here",
  DigStraight = "dig-s",
  DigStraightHere = "dig-s-here",
  DropAll = "drop-all",
  Eat = "eat",
  EstimateTime = "estimate-time",
  Follow = "follow",
  GoTo = "go-to",
  Inventory = "inventory",
  ManageFarm = "manage-farm",
  MyPosition = "my-pos",
  PrintState = "print-state",
  ReEnter = "re-enter",
  ReportPosition = "report-position",
  SaveChest = "save-chest",
  SetConstantGoal = "set-constant-goal",
  SetLogLevel = "set-log-level",
  SetRespawn = "set-respawn",
  Stop = "stop",
  ToogleAddTorches = "toggle-add-torches",
  YourPosition = "your-pos",
}

const aliases: Record<string, ChatCommand | undefined> = {
  a: ChatCommand.Attack,
  c: ChatCommand.Commands,
  ce: ChatCommand.ClosestEntity,
  ch: ChatCommand.ComeHere,
  da: ChatCommand.DropAll,
  di: ChatCommand.DigInfo,
  dr: ChatCommand.DigRange,
  drh: ChatCommand.DigRangeHere,
  ds: ChatCommand.DigStraight,
  dsh: ChatCommand.DigStraightHere,
  e: ChatCommand.Eat,
  et: ChatCommand.EstimateTime,
  f: ChatCommand.Follow,
  g: ChatCommand.GoTo,
  i: ChatCommand.Inventory,
  l: ChatCommand.SetLogLevel,
  mf: ChatCommand.ManageFarm,
  p: ChatCommand.MyPosition,
  ps: ChatCommand.PrintState,
  re: ChatCommand.ReEnter,
  rp: ChatCommand.ReportPosition,
  s: ChatCommand.Stop,
  sc: ChatCommand.SetConstantGoal,
  sch: ChatCommand.SaveChest,
  sr: ChatCommand.SetRespawn,
  tt: ChatCommand.ToogleAddTorches,
  y: ChatCommand.YourPosition,
};

type UpdateEvent =
  | {
      content: ChatCommand;
      isTargeted: boolean;
      opts: string;
      type: "chat";
      username: string;
    }
  | {
      focusRange?: BotState["focusRange"];
      goal?: Goal;
      initialBlock?: BotState["initialBlock"];
      type: "setState";
    }
  | {
      type: "clear";
    }
  | {
      type: "end";
    }
  | {
      type: "error";
    }
  | {
      type: "fetch-world";
    }
  | {
      type: "hurtWarning";
    }
  | {
      type: "interval";
    };

type AsyncOperationContext = {
  stateCopy: BotState;
};

const skipToDig = [
  "_wall",
  "hopper",
  "chest",
  "crafting_table",
  "diamond",
  "furnace",
  "emerald",
  "gold",
  "lapis",
  "redstone",
];

const DISTANCE_BETWEEN_TORCHES_RANGE = 5;

const MAX_HEIGHT_STRAIGHT = 1;
const MAX_HEIGHT_RANGE = 4;

const MAX_DIG_STRAIGHT = 200;

const botMustKeepItems = [
  "bread",
  "stone_axe",
  "stone_hoe",
  "stone_pickaxe",
  "stone_shovel",
  "stone_sword",
  "torch",
  "wheat_seeds",
];

type DaemonContext = {
  bots: Record<number, AsyncOperationContext>;
  logger: Logger;
};

export {
  type BotState,
  type Context,
  type DaemonContext,
  type Direction,
  type FlatRect,
  type Goal,
  type Point3D,
  type Range3D,
  type UpdateEvent,
  aliases,
  botMustKeepItems,
  ChatCommand,
  DISTANCE_BETWEEN_TORCHES_RANGE,
  goalAliases,
  GoalName,
  LogLevel,
  logLevels,
  MAX_DIG_STRAIGHT,
  MAX_HEIGHT_RANGE,
  MAX_HEIGHT_STRAIGHT,
  skipToDig,
};

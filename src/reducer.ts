import {
  type BotState,
  type Context,
  type UpdateEvent,
  aliases,
  ChatCommand,
  GoalName,
} from "./base";
import { daemonClient } from "./daemon-client";
import { handleDigging } from "./handlers/digging";
import { handleEat } from "./handlers/eat";
import { handleFarming } from "./handlers/farming";
import { handleFollow } from "./handlers/follow";
import { handleMonitorChest } from "./handlers/monitor-chest";
import {
  autoAttack,
  autoEat,
  getShouldAttack,
  getShouldEat,
} from "./handlers/survival";
import {
  type Command,
  attack,
  closestEntity,
  comeHere,
  commands,
  digInfo,
  digRange,
  digRangeHere,
  digStraight,
  digStraightHere,
  dropAll,
  eat,
  estimateTime,
  follow,
  goTo,
  inventory,
  manageFarm,
  myPosition,
  printState,
  reEnter,
  reportPosition,
  saveChest,
  setConstantGoal,
  setLogLevel,
  setRespawn,
  stop,
  toggleAddTorches,
  yourPosition,
} from "./reducer/commands";

const chatHandlers: Record<ChatCommand, Command> = {
  [ChatCommand.Attack]: attack,
  [ChatCommand.ClosestEntity]: closestEntity,
  [ChatCommand.ComeHere]: comeHere,
  [ChatCommand.Commands]: commands,
  [ChatCommand.DigInfo]: digInfo,
  [ChatCommand.DigRange]: digRange,
  [ChatCommand.DigRangeHere]: digRangeHere,
  [ChatCommand.DigStraight]: digStraight,
  [ChatCommand.DigStraightHere]: digStraightHere,
  [ChatCommand.DropAll]: dropAll,
  [ChatCommand.Eat]: eat,
  [ChatCommand.EstimateTime]: estimateTime,
  [ChatCommand.Follow]: follow,
  [ChatCommand.GoTo]: goTo,
  [ChatCommand.Inventory]: inventory,
  [ChatCommand.ManageFarm]: manageFarm,
  [ChatCommand.MyPosition]: myPosition,
  [ChatCommand.PrintState]: printState,
  [ChatCommand.ReEnter]: reEnter,
  [ChatCommand.ReportPosition]: reportPosition,
  [ChatCommand.SaveChest]: saveChest,
  [ChatCommand.SetConstantGoal]: setConstantGoal,
  [ChatCommand.SetLogLevel]: setLogLevel,
  [ChatCommand.SetRespawn]: setRespawn,
  [ChatCommand.Stop]: stop,
  [ChatCommand.ToogleAddTorches]: toggleAddTorches,
  [ChatCommand.YourPosition]: yourPosition,
};

const isLowestMinion = (state: BotState): boolean => {
  const { bot } = state;

  const currentBotNumber = Number(
    (bot.entity.username || "").match(/^minion(\d+)$/)?.[1],
  );

  const connectedMinionNumbers = Object.values(bot.players)
    .filter((player) => !!player.entity)
    .map((player) =>
      Number((player.username || "").match(/^minion(\d+)$/)?.[1]),
    )
    .filter((number) => !Number.isNaN(number));

  const lowestMinionNumber = Math.min(
    currentBotNumber,
    ...connectedMinionNumbers,
  );

  return currentBotNumber === lowestMinionNumber;
};

const asyncReducer = async (
  context: Context,
  updateEvent: UpdateEvent,
): Promise<Context> => {
  const [nextState] = context;

  const { bot } = nextState;

  const { type: eventType } = updateEvent;

  if (getShouldAttack(nextState)) {
    return autoAttack(context);
  }

  if (Math.random() > 1) {
    if (getShouldEat(nextState)) {
      return autoEat(context);
    }
  }

  switch (eventType) {
    case "chat": {
      if (!updateEvent.isTargeted && !isLowestMinion(nextState)) {
        return context;
      }

      const aliased = aliases[updateEvent.content] || updateEvent.content;

      const result = chatHandlers[aliased]?.(context, updateEvent);

      if (result) return result;

      break;
    }

    case "clear": {
      nextState.currentGoal = null;
      break;
    }

    case "end": {
      break;
    }

    case "error": {
      break;
    }

    case "fetch-world": {
      const world = await daemonClient.getWorld();

      if (!world) throw new Error("world.json does not exist");

      nextState.world = world;
      break;
    }

    case "hurtWarning": {
      bot.chat("WARNING: I'm being hurt!");
      break;
    }

    case "interval": {
      const { constantGoal, currentGoal } = nextState;

      const goal =
        constantGoal && constantGoal !== GoalName.Unknown
          ? constantGoal
          : currentGoal;

      if (!goal) return context;

      switch (goal) {
        case GoalName.DigRange:
          return handleDigging(context);
        case GoalName.Eat:
          return handleEat(context);
        case GoalName.Follow:
          return handleFollow(context);
        case GoalName.ReportPosition:
        case GoalName.Unknown:
          return context;

        default: {
          if (typeof goal === "object") {
            if (goal.name === GoalName.ManageFarm) {
              return handleFarming(context);
            } else if (goal.name === GoalName.MonitorChest) {
              return handleMonitorChest(context);
            }
          } else {
            goal satisfies never;
          }
        }
      }

      break;
    }

    case "setState": {
      if (typeof updateEvent.goal !== "undefined") {
        if (nextState.constantGoal) {
          nextState.constantGoal = updateEvent.goal;
        } else {
          nextState.currentGoal = updateEvent.goal;
        }
      }

      if (typeof updateEvent.focusRange !== "undefined") {
        nextState.focusRange = updateEvent.focusRange;
      }

      if (typeof updateEvent.initialBlock !== "undefined") {
        nextState.initialBlock = updateEvent.initialBlock;
      }

      break;
    }

    default: {
      eventType satisfies never;
      break;
    }
  }

  return context;
};

export { asyncReducer };

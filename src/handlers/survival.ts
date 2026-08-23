import { type BotState, type Context, GoalName } from "../base";
import { getDiggingUpdateEvent, goToGetItem } from "../utils";

const findNearHostileEntity = (nextState: BotState) => {
  const { bot } = nextState;

  return bot.nearestEntity(
    (e) =>
      e.type === "hostile" && e.position.distanceTo(bot.entity.position) < 2,
  );
};

const getShouldAttack = (nextState: BotState): boolean =>
  !!findNearHostileEntity(nextState);

const getShouldEat = (nextState: BotState): boolean => {
  const { bot } = nextState;

  return bot.food < 10;
};

const autoEat = async (context: Context): Promise<Context> => {
  const [nextState] = context;
  const { bot } = nextState;

  if (nextState.currentGoal === GoalName.Eat) {
    return context;
  }

  const bread = bot.inventory.items().find((item) => item?.name === "bread");

  const { currentGoal, focusRange, initialBlock } = nextState;

  const finishEvent =
    currentGoal === GoalName.DigRange && focusRange && initialBlock
      ? getDiggingUpdateEvent(initialBlock, focusRange)
      : ({ type: "clear" } as const);

  nextState.currentGoal = GoalName.Eat;

  if (!bread) {
    bot.chat("I have no bread");

    return goToGetItem(context, {
      chests: nextState.world.diggingChests,
      finishEvent,
      item: { name: "bread" },
      meanwhileGoal: GoalName.Eat,
      stackInfo: [1, 5],
    });
  }

  bot.chat("Eating bread");
  bot.equip(bread, "hand").catch(() => {});

  const eatInLoop = async (num: number): Promise<void> => {
    if (bot.food < 20 && num < 10) {
      return bot
        .consume()
        .then(() => eatInLoop(num + 1))
        .then(() => {});
    }
  };

  const [, eventsQueue] = context;

  const asyncAction = () =>
    new Promise((r) => setTimeout(r, 1000))
      .then(() => eatInLoop(0))
      .then(() => eventsQueue.push(finishEvent))
      .catch(() => {
        bot.chat("Error while eating");

        eventsQueue.push(finishEvent);
      });

  await asyncAction();

  return context;
};

const autoAttack = async (context: Context): Promise<Context> => {
  const [nextState] = context;
  const { bot } = nextState;
  const entity = findNearHostileEntity(nextState);

  if (!entity) return context;

  const sword = bot.inventory
    .items()
    .find((item) => item?.name === "stone_sword");

  const start = sword
    ? bot.equip(sword, "hand").catch(() => {})
    : Promise.resolve();

  const asyncAction = () =>
    start
      .then(() => {
        bot.chat("Attacking near hostile entity");
        bot.attack(entity);
      })
      .catch(() => {});

  await asyncAction();

  return context;
};

export { autoAttack, autoEat, getShouldAttack, getShouldEat };

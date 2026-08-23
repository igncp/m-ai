import { type Context } from "../base";
import { getEquippedItem } from "../utils";

const handleEat = async (context: Context): Promise<Context> => {
  const [nextState] = context;
  const { bot } = nextState;

  const equippedItem = getEquippedItem(bot);

  if (equippedItem?.name !== "bread") {
    const bread = bot.inventory.items().find((item) => item?.name === "bread");

    if (bread) {
      bot.equip(bread, "hand");
    } else {
      bot.chat("I have no bread");
      nextState.currentGoal = null;
    }

    return context;
  }

  if (bot.food < 20) {
    bot.consume().catch(() => {});
  } else {
    bot.chat("I'm full");
    nextState.currentGoal = null;
  }

  return context;
};

export { handleEat };

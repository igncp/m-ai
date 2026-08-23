import { goals } from "mineflayer-pathfinder";

import { type Context } from "../base";

const handleFollow = async (context: Context): Promise<Context> => {
  const [nextState] = context;
  const { bot, followTarget } = nextState;

  if (!followTarget) {
    return context;
  }

  bot.lookAt(followTarget.position.offset(0, followTarget.height, 0));

  bot.pathfinder.setGoal(
    new goals.GoalNear(
      followTarget.position.x,
      followTarget.position.y,
      followTarget.position.z,
      2,
    ),
  );

  return context;
};

export { handleFollow };

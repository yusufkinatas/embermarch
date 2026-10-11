/** Route -> screen factory. */
import type { AppCtx, Route, ScreenHandle } from '../types';
import { mountTitle } from './title';
import { mountSetup } from './setup';
import { mountMap } from './map';
import { mountBriefing } from './briefing';
import { mountBattle } from './battle';
import { mountResults } from './results';
import { mountReward } from './reward';
import { mountRetinue } from './retinue';
import { mountEvent } from './event';
import { mountCamp } from './camp';
import { mountPeddler } from './peddler';
import { mountSummary } from './summary';
import { mountHall } from './hall';
import { mountHowTo } from './howto';

export function mountScreen(app: AppCtx, route: Route): ScreenHandle {
  switch (route.screen) {
    case 'title':
      return mountTitle(app);
    case 'setup':
      return mountSetup(app);
    case 'map':
      return mountMap(app);
    case 'briefing':
      return mountBriefing(app, route.briefing);
    case 'battle':
      return mountBattle(app, route.setup, route.quick);
    case 'results':
      return mountResults(app, route.result, route.post, route.quick);
    case 'reward':
      return mountReward(app);
    case 'retinue':
      return mountRetinue(app);
    case 'event':
      return mountEvent(app, route.event);
    case 'camp':
      return mountCamp(app);
    case 'peddler':
      return mountPeddler(app);
    case 'summary':
      return mountSummary(app, route.summary);
    case 'hall':
      return mountHall(app, route.from ?? 'title');
    case 'howto':
      return mountHowTo(app);
  }
}

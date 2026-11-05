import { State } from '../domain/model';
import { WidgetTick } from '../domain/widget-list';

export async function publishTodayList(_state: State): Promise<void> {}

export async function readWidgetTicks(): Promise<WidgetTick[]> {
  return [];
}

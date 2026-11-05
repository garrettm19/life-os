import { View } from 'react-native';
import { Block } from '../domain/model';
import { setBundledStatus } from '../domain/planner';
import { withDay } from '../domain/data';
import { useSave } from '../state/app-state';
import { StepRow } from './objective-row';

export function BundledRoutines({
  block,
  date,
  nextStepId,
}: {
  block: Block;
  date: string;
  /** The bundled step that is the next thing to do, once its workout itself is recorded. */
  nextStepId?: string;
}) {
  const { change } = useSave();
  if (!block.bundledSteps?.length) return null;
  return (
    <View style={{ paddingBottom: 4 }}>
      {block.bundledSteps.map((step) => (
        <StepRow
          key={step.id}
          title={step.title}
          status={step.status}
          next={step.id === nextStepId}
          onCheck={() =>
            change((s) =>
              withDay(
                s,
                setBundledStatus(
                  s.days[date],
                  block.id,
                  step.id,
                  step.status === 'planned' ? 'done' : 'planned',
                ),
              ),
            )
          }
          onSkip={() =>
            void change((s) =>
              withDay(s, setBundledStatus(s.days[date], block.id, step.id, 'skipped')),
            )
          }
        />
      ))}
    </View>
  );
}

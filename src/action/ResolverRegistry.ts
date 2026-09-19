import type { GameAction } from './ActionTypes';
import type { ActionResolver } from './resolvers/ResolverTypes';
import {
  ArmorResolver,
  BeginDrawResolver,
  ConfirmDrawResolver,
  AttackResolver,
  DrawResolver,
  DeployGeneralResolver,
  MoveGeneralResolver,
  SupplyResolver,
  TurnResolver,
  ResolveBaseLossResolver,
  SurrenderResolver,
} from './resolvers';

export class ResolverRegistry {
  private readonly resolvers: ActionResolver[] = [
    new DrawResolver(),
    new BeginDrawResolver(),
    new ConfirmDrawResolver(),
    new DeployGeneralResolver(),
    new MoveGeneralResolver(),
    new AttackResolver(),
    new SupplyResolver(),
    new ArmorResolver(),
    new TurnResolver(),
    new ResolveBaseLossResolver(),
    new SurrenderResolver(),
  ];

  getResolver(action: GameAction): ActionResolver | undefined {
    return this.resolvers.find(resolver => resolver.canResolve(action));
  }

  getAll(): readonly ActionResolver[] {
    return this.resolvers;
  }
}

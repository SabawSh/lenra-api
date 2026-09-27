import { PuzzlePart } from "@/types/puzzle";
import { OrderValidationResult } from "./orderValidation";
import { PuzzleState } from "./puzzelReducer";

type State = {
  originalParts: PuzzlePart[];
  puzzle: PuzzleState;
  orderStatus: OrderValidationResult;
  firstWrongIndex: number | null;
  isListening: boolean;
};

type Action =
  | { type: "init"; parts: PuzzlePart[]; shuffled: PuzzlePart[] }
  | {
      type: "updatePuzzle";
      puzzle: PuzzleState;
      orderStatus: OrderValidationResult;
      firstWrongIndex: number | null;
    }
  | { type: "setListening"; listening: boolean }
  | { type: "resetPuzzle"; shuffled: PuzzlePart[] };

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "init":
      return {
        originalParts: action.parts,
        puzzle: { selected: [], available: action.shuffled },
        orderStatus: "incomplete",
        firstWrongIndex: null,
        isListening: false,
      };
    case "updatePuzzle":
      return {
        ...state,
        puzzle: action.puzzle,
        orderStatus: action.orderStatus,
        firstWrongIndex: action.firstWrongIndex,
      };
    case "setListening":
      return { ...state, isListening: action.listening };
    case "resetPuzzle":
      return {
        ...state,
        puzzle: { selected: [], available: action.shuffled },
        orderStatus: "incomplete",
        firstWrongIndex: null,
      };
    default:
      return state;
  }
}

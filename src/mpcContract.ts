import { Contract, Account } from "near-api-js";
import { Address } from "viem";
import {
  deriveChildPublicKey,
  najPublicKeyStrToUncompressedHexPoint,
  uncompressedHexPointToEvmAddress,
} from "./utils/kdf";
import { NO_DEPOSIT, nearAccountFromEnv, TGAS } from "./chains/near";
import {
  MPCSignature,
  NearContractFunctionPayload,
  SignArgs,
} from "./types/types";

/// Near Contract Type for change methods
export interface ChangeMethodArgs<T> {
  /// Change method function agruments.
  args: T;
  /// GasLimit on transaction execution.
  gas: string;
  /// Deposit (i.e. payable amount) to attach to transaction.
  attachedDeposit: string;
}

interface MultichainContractInterface extends Contract {
  // Define the signature for the `public_key` view method
  public_key: () => Promise<string>;

  // Define the signature for the `sign` change method
  sign: (args: ChangeMethodArgs<SignArgs>) => Promise<[string, string]>;
}

/**
 * High-level interface for the Near MPC-Recovery Contract
 * located in: https://github.com/near/mpc-recovery
 */
export class MultichainContract {
  contract: MultichainContractInterface;

  constructor(account: Account, contractId: string) {
    this.contract = new Contract(account, contractId, {
      changeMethods: ["sign"],
      viewMethods: ["public_key"],
      useLocalViewExecution: false,
    }) as MultichainContractInterface;
  }

  static async fromEnv(): Promise<MultichainContract> {
    const account = await nearAccountFromEnv();
    return new MultichainContract(
      account,
      process.env.NEAR_MULTICHAIN_CONTRACT!
    );
  }

  deriveEthAddress = async (derivationPath: string): Promise<Address> => {
    const rootPublicKey = await this.contract.public_key();

    const publicKey = await deriveChildPublicKey(
      najPublicKeyStrToUncompressedHexPoint(rootPublicKey),
      this.contract.account.accountId,
      derivationPath
    );

    return uncompressedHexPointToEvmAddress(publicKey);
  };

  requestSignature = async (
    signArgs: SignArgs,
    gas?: bigint
  ): Promise<MPCSignature> => {
    const [big_r, big_s] = await this.contract.sign({
      args: signArgs,
      gas: gasOrDefault(gas),
      attachedDeposit: NO_DEPOSIT,
    });
    return { big_r, big_s };
  };

  encodeSignatureRequestTx(
    signArgs: SignArgs,
    gas?: bigint
  ): NearContractFunctionPayload {
    return {
      signerId: this.contract.account.accountId,
      receiverId: this.contract.contractId,
      actions: [
        {
          type: "FunctionCall",
          params: {
            methodName: "sign",
            args: signArgs,
            gas: gasOrDefault(gas),
            deposit: NO_DEPOSIT,
          },
        },
      ],
    };
  }
}

function gasOrDefault(gas?: bigint): string {
  if (gas !== undefined) {
    return gas.toString();
  }
  // Default of 300 TGAS
  return (TGAS * 300n).toString();
}

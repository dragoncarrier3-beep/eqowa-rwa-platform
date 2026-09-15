// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {MinimalForwarder} from "@openzeppelin/contracts/metatx/MinimalForwarder.sol";

/** Compiles OZ's MinimalForwarder into this repo so Hardhat tests can deploy it. */
contract EqowaMinimalForwarder is MinimalForwarder {}

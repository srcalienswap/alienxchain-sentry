import {NodeLicenseTests} from "./NodeLicense.mjs";
import { parse } from "csv/sync";
import fs from "fs";
import { XaiTests } from "./Xai.mjs";
import { config, createBlsKeyPair } from "@sentry/core";
import { RuntimeTests } from "./Runtime.mjs";
import { UpgradeabilityTests } from "./UpgradeTest.mjs";
import { RefereeTests } from "./Referee.mjs";
import { esXaiTests } from "./esXai.mjs";
import { GasSubsidyTests } from "./GasSubsidy.mjs";
import { XaiGaslessClaimTests } from "./XaiGaslessClaim.mjs";
import {CNYAirDropTests} from "./CNYAirDrop.mjs";

describe("Fixture Tests", function () {

    // We define a fixture to reuse the same setup in every test. We use
    // loadFixture to run this setup once, snapshot that state, and reset Hardhat
    // Network to that snapshot in every test.
    async function deployInfrastructure() {

        // Get addresses to use in the tests
        const [
            deployer,
            challenger,
            fundsReceiver,
            refereeDefaultAdmin,
            kycAdmin,
            xaiDefaultAdmin,
            xaiMinter,
            esXaiDefaultAdmin,
            esXaiMinter,
            gasSubsidyDefaultAdmin,
            gasSubsidyTransferAdmin,
            nodeLicenseDefaultAdmin,
            addr1,
            addr2,
            addr3,
            operator,
        ] = await ethers.getSigners();

        // Deploy Xai
        const Xai = await ethers.getContractFactory("Xai");
        const xai = await upgrades.deployProxy(Xai, [], { deployer: deployer });
        await xai.waitForDeployment();

        // Deploy esXai
        const EsXai = await ethers.getContractFactory("esXai");
        const esXai = await upgrades.deployProxy(EsXai, [await xai.getAddress()], { deployer: deployer });
        await esXai.waitForDeployment();
        
        //Upgrade esXai
        const EsXai2 = await ethers.getContractFactory("esXai2");
        const esXai2 = await upgrades.upgradeProxy((await esXai.getAddress()), EsXai2, { call: { fn: "initialize", args: [(await deployer.getAddress()), BigInt(500)] } });
        await esXai2.waitForDeployment();

        // Set esXai on Xai
        await xai.setEsXaiAddress(await esXai.getAddress());

        // Deploy Gas Subsidy
        const GasSubsidy = await ethers.getContractFactory("GasSubsidy");
        const gasSubsidy = await upgrades.deployProxy(GasSubsidy, [], { deployer: deployer });
        await gasSubsidy.waitForDeployment();

        // Deploy Referee
        const Referee = await ethers.getContractFactory("Referee");
        const gasSubsidyPercentage = BigInt(15);
        const referee = await upgrades.deployProxy(Referee, [await esXai.getAddress(), await xai.getAddress(), await gasSubsidy.getAddress(), gasSubsidyPercentage], { deployer: deployer });
        await referee.waitForDeployment();
        //Upgrade Referee
        const Referee2 = await ethers.getContractFactory("Referee2");
        const referee2 = await upgrades.upgradeProxy((await referee.getAddress()), Referee2, { call: { fn: "initialize", args: [] } });
        await referee2.waitForDeployment();
        await referee2.enableStaking();
                
        const Referee3 = await ethers.getContractFactory("Referee3");
        const referee3 = await upgrades.upgradeProxy((await referee.getAddress()), Referee3, { call: { fn: "initialize", args: [] } });
        await referee3.waitForDeployment();
        await referee3.enableStaking();

        const Referee4 = await ethers.getContractFactory("Referee4");
        const referee4 = await upgrades.upgradeProxy((await referee.getAddress()), Referee4);
        await referee4.waitForDeployment();
        await referee4.enableStaking();

        // Set Rollup Address
        const rollupAddress = config.rollupAddress;
        await referee.setRollupAddress(rollupAddress);

        // Attach a contract of the Rollup Contract
        // const RollupUserLogic = await ethers.getContractFactory("RollupUserLogic");
        const rollupContract = await ethers.getContractAt("RollupUserLogic", rollupAddress);

        // Deploy Node License
        const NodeLicense = await ethers.getContractFactory("NodeLicense");
        const referralDiscountPercentage = BigInt(10);
        const referralRewardPercentage = BigInt(2);
        const nodeLicense = await upgrades.deployProxy(NodeLicense, [await fundsReceiver.getAddress(), referralDiscountPercentage, referralRewardPercentage], { deployer: deployer });
        await nodeLicense.waitForDeployment();

        // Set the Node License Address
        await referee.setNodeLicenseAddress(await nodeLicense.getAddress());

        // Read the csv from tierUpload.csv, and add the pricing tiers to NodeLicense
        const tiers = parse(fs.readFileSync('tierUpload.csv'), { columns: true });
        for (const tier of tiers) {
            await nodeLicense.setOrAddPricingTier(tier.tierIndex, ethers.parseEther(tier.unitCostInEth.toString()), tier.quantityBeforeNextTier);
        }

        // set a Challenger Public key
        const {secretKeyHex, publicKeyHex} = await createBlsKeyPair("29dba7dc550c653b085e9c067d2b6c3b0859096204b6892c697982ed52e720f5");
        await referee.setChallengerPublicKey("0x" + publicKeyHex);

        // Setup Xai roles
        const xaiAdminRole = await xai.DEFAULT_ADMIN_ROLE();
        await xai.grantRole(xaiAdminRole, await xaiDefaultAdmin.getAddress());
        const xaiMinterRole = await xai.MINTER_ROLE();
        await xai.grantRole(xaiMinterRole, await xaiMinter.getAddress());
        await xai.grantRole(xaiMinterRole, await referee.getAddress());
        await xai.grantRole(xaiMinterRole, await esXai.getAddress());

        // Setup esXai Roles
        const esXaiAdminRole = await esXai.DEFAULT_ADMIN_ROLE();
        await esXai.grantRole(esXaiAdminRole, await esXaiDefaultAdmin.getAddress());
        const esXaiMinterRole = await esXai.MINTER_ROLE();
        await esXai.grantRole(esXaiMinterRole, await esXaiMinter.getAddress());
        await esXai.grantRole(esXaiMinterRole, await referee.getAddress());
        await esXai.grantRole(esXaiMinterRole, await xai.getAddress());
        await esXai.addToWhitelist(await referee.getAddress());

        // Setup Node License Roles 
        const nodeLicenseAdminRole = await nodeLicense.DEFAULT_ADMIN_ROLE();
        await nodeLicense.grantRole(nodeLicenseAdminRole, await nodeLicenseDefaultAdmin.getAddress());

        // Setup Gas Subsidy License Roles
        const gasSubsidyAdminRole = await gasSubsidy.DEFAULT_ADMIN_ROLE();
        await gasSubsidy.grantRole(gasSubsidyAdminRole, await gasSubsidyDefaultAdmin.getAddress());
        const gasSubsidyTransferRole = await gasSubsidy.TRANSFER_ROLE();
        await gasSubsidy.grantRole(gasSubsidyTransferRole, await gasSubsidyTransferAdmin.getAddress());

        // Set the Rollup Address on Referee
        await referee.setRollupAddress

        // Setup Referee Roles
        const refereeAdminRole = await referee.DEFAULT_ADMIN_ROLE();
        await referee.grantRole(refereeAdminRole, refereeDefaultAdmin.getAddress());
        const challengerRole = await referee.CHALLENGER_ROLE();
        await referee.grantRole(challengerRole, await challenger.getAddress());
        const kycAdminRole = await referee.KYC_ADMIN_ROLE();
        await referee.grantRole(kycAdminRole, await kycAdmin.getAddress());   

        // Renounce the default admin role of the deployer
        await referee.renounceRole(refereeAdminRole, await deployer.getAddress());
        await nodeLicense.renounceRole(nodeLicenseAdminRole, await deployer.getAddress());
        await gasSubsidy.renounceRole(gasSubsidyAdminRole, await deployer.getAddress());
        await esXai.renounceRole(esXaiAdminRole, await deployer.getAddress());
        await xai.renounceRole(xaiAdminRole, await deployer.getAddress());

        // Mint addr1 a node license
        let price = await nodeLicense.price(1, "");
        await nodeLicense.connect(addr1).mint(1, "", {value: price});

        // Mint addr2 10 node licenses
        price = await nodeLicense.price(10, "");
        await nodeLicense.connect(addr2).mint(10, "", {value: price});

        // Mint addr3 a node license
        price = await nodeLicense.price(1, "");
        await nodeLicense.connect(addr3).mint(1, "", {value: price});

        // KYC addr1 and addr 2, but not addr 3
        await referee.connect(kycAdmin).addKycWallet(await addr1.getAddress());
        await referee.connect(kycAdmin).addKycWallet(await addr2.getAddress());

        // Add addr 1 to the operator
        await referee.connect(addr1).setApprovalForOperator(await operator.getAddress(), true);

        // Impersonate the rollup controller
        const rollupController = await ethers.getImpersonatedSigner("0x6347446605e6f6680addb7c4ff55da299ecd2e69");

        config.esXaiAddress = await esXai.getAddress();
        config.esXaiDeployedBlockNumber = (await esXai.deploymentTransaction()).blockNumber;
        config.gasSubsidyAddress = await gasSubsidy.getAddress();
        config.gasSubsidyDeployedBlockNumber = (await gasSubsidy.deploymentTransaction()).blockNumber;
        config.nodeLicenseAddress = await nodeLicense.getAddress();
        config.nodeLicenseDeployedBlockNumber = (await nodeLicense.deploymentTransaction()).blockNumber;
        config.refereeAddress = await referee.getAddress();
        config.refereeDeployedBlockNumber = (await referee.deploymentTransaction()).blockNumber;
        config.xaiAddress = await xai.getAddress();
        config.xaiDeployedBlockNumber = (await xai.deploymentTransaction()).blockNumber;
        config.defaultRpcUrl = "http://localhost:8545/";

        return {
            deployer,
            challenger,
            fundsReceiver,
            refereeDefaultAdmin,
            kycAdmin,
            xaiDefaultAdmin,
            xaiMinter,
            esXaiDefaultAdmin,
            esXaiMinter,
            gasSubsidyDefaultAdmin,
            gasSubsidyTransferAdmin,
            nodeLicenseDefaultAdmin,
            addr1,
            addr2,
            addr3,
            operator,
            rollupController,

            tiers,
            secretKeyHex,
            publicKeyHex: "0x" + publicKeyHex,

            referee: referee4,
            nodeLicense,
            gasSubsidy,
            esXai: esXai2,
            xai,
            rollupContract
        };
    }

    // describe("CNY 2024", CNYAirDropTests.bind(this));
    // describe("Xai Gasless Claim", XaiGaslessClaimTests(deployInfrastructure).bind(this));
    // describe("Xai", XaiTests(deployInfrastructure).bind(this));
    // describe("EsXai", esXaiTests(deployInfrastructure).bind(this));
    // describe("Node License", NodeLicenseTests(deployInfrastructure).bind(this));
    describe("Referee", RefereeTests(deployInfrastructure).bind(this));
    // describe("Gas Subsidy", GasSubsidyTests(deployInfrastructure).bind(this));
    // describe("Upgrade Tests", UpgradeabilityTests(deployInfrastructure).bind(this));

    // This doesn't work when running coverage
    // describe("Runtime", RuntimeTests(deployInfrastructure).bind(this));

})

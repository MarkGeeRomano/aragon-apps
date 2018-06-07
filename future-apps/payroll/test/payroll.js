const { assertRevert, assertInvalidOpcode } = require('@aragon/test-helpers/assertThrow');
const getBalance = require('@aragon/test-helpers/balance')(web3);
const getTransaction = require('@aragon/test-helpers/transaction')(web3);
const MiniMeToken = artifacts.require('@aragon/os/contracts/common/MiniMeToken');
const Vault = artifacts.require('Vault');
const Finance = artifacts.require('Finance');
const Payroll = artifacts.require("PayrollMock");
const PriceFeedMock = artifacts.require("./feed/PriceFeedMock.sol");
const PriceFeedFailMock = artifacts.require("./feed/PriceFeedFailMock.sol");
const Zombie = artifacts.require("Zombie.sol");

contract('Payroll', function(accounts) {
  const rateExpiryTime = 1000;
  const USD_DECIMALS= 18;
  const USD_PRECISION = 10**USD_DECIMALS;
  const SECONDS_IN_A_YEAR = 31557600; // 365.25 days
  const ONE = 1e18
  const ETH = '0x0'
  let payroll;
  let payroll2;
  let finance;
  let vault;
  let owner = accounts[0];
  let priceFeed;
  let employee1_1 = accounts[2];
  let employee1 = employee1_1;
  let employee2 = accounts[3];
  let employee1_2 = accounts[4];
  let unused_account = accounts[7];
  let total_salary = 0;
  let salary1_1 = (new web3.BigNumber(100000)).times(USD_PRECISION);
  let salary1_2 = (new web3.BigNumber(110000)).times(USD_PRECISION);
  let salary1 = salary1_1;
  let salary2_1 = (new web3.BigNumber(120000)).times(USD_PRECISION);
  let salary2_2 = (new web3.BigNumber(125000)).times(USD_PRECISION);
  let salary2 = salary2_1;
  let usdToken;
  let erc20Token1;
  let erc20Token2;
  let erc20Token1ExchangeRate;
  let erc20Token2ExchangeRate;
  const erc20Token1Decimals = 18;
  const erc20Token2Decimals = 16;
  let etherExchangeRate

  const deployErc20Token = async (name="ERC20Token", decimals=18) => {
    let token = await MiniMeToken.new("0x0", "0x0", 0, name, decimals, 'E20', true); // dummy parameters for minime
    let amount = new web3.BigNumber(10**9).times(new web3.BigNumber(10**decimals));
    let sender = owner;
    let receiver = finance.address;
    let initialSenderBalance = await token.balanceOf(sender);
    let initialVaultBalance = await token.balanceOf(vault.address);
    await token.generateTokens(sender, amount);
    await token.approve(receiver, amount, {from: sender});
    await finance.deposit(token.address, amount, "Initial deployment", {from: sender});
    assert.equal((await token.balanceOf(sender)).toString(), initialSenderBalance.toString());
    assert.equal((await token.balanceOf(vault.address)).toString(), (new web3.BigNumber(initialVaultBalance).plus(amount)).toString());
    return token;
  };

  const addAllowedTokens = async(payroll, tokens) => {
    const currencies = [ETH].concat(tokens.map(c => c.address))
    await Promise.all(currencies.map(token => payroll.addAllowedToken(token)))
  }

  const getTimePassed = async (employeeId) => {
    let employee = await payroll.getEmployee(employeeId);
    let currentTime = await payroll.getTimestampPublic();
    let timePassed = currentTime - employee[3];
    return new Promise(resolve => {resolve(timePassed);});
  };

  before(async () => {
    vault = await Vault.new();
    await vault.initializeWithBase(vault.address)
    finance = await Finance.new();
    await finance.initialize(vault.address, 100);

    usdToken = await deployErc20Token("USD", USD_DECIMALS);
    priceFeed = await PriceFeedMock.new();
    payroll = await Payroll.new();

    // Deploy ERC 20 Tokens
    erc20Token1 = await deployErc20Token("Token 1", erc20Token1Decimals);
    erc20Token2 = await deployErc20Token("Token 2", erc20Token2Decimals);

    // get exchange rates
    erc20Token1ExchangeRate = (await priceFeed.get(usdToken.address, erc20Token1.address))[0]
    erc20Token2ExchangeRate = (await priceFeed.get(usdToken.address, erc20Token2.address))[0]
    etherExchangeRate = (await priceFeed.get(usdToken.address, ETH))[0]

    // transfer ETH to Payroll contract
    for (let i = 1; i < 9; i++)
      await finance.sendTransaction({ from: accounts[i], value: web3.toWei(90, 'ether') });
  })

  it("fails to initialize with empty finance", async () => {
    return assertRevert(async () => {
      await payroll.initialize('0x0', usdToken.address, priceFeed.address, rateExpiryTime);
    })
  })

  it("initializes contract and checks that initial values match", async () => {
    await payroll.initialize(finance.address, usdToken.address, priceFeed.address, rateExpiryTime);
    let tmpFinance = await payroll.finance();
    assert.equal(tmpFinance.valueOf(), finance.address, "Finance address is wrong");
    let tmpUsd = await payroll.denominationToken();
    assert.equal(tmpUsd.valueOf(), usdToken.address, "USD Token address is wrong");
  });

  it('fails on reinitialization', async () => {
    return assertRevert(async () => {
      await payroll.initialize(finance.address, usdToken.address, priceFeed.address, rateExpiryTime);
    });
  });

  it("add allowed tokens", async () => {
    // add them to payroll allowed tokens
    await addAllowedTokens(payroll, [usdToken, erc20Token1, erc20Token2])
    assert.isTrue(await payroll.isTokenAllowed(usdToken.address), "USD Token should be allowed")
    assert.isTrue(await payroll.isTokenAllowed(erc20Token1.address), "ERC 20 Token 1 should be allowed")
    assert.isTrue(await payroll.isTokenAllowed(erc20Token2.address), "ERC 20 Token 2 should be allowed")
  });

  it("fails trying to add an already allowed token", async () => {
    return assertRevert(async () => {
      await payroll.addAllowedToken(usdToken.address);
    });
  });

  const convertAndRoundSalary = function (a) {
    return a.dividedToIntegerBy(SECONDS_IN_A_YEAR).times(SECONDS_IN_A_YEAR);
  };

  it("adds employee", async () => {
    let name = '';
    let employeeId = 1;
    await payroll.addEmployee(employee1_1, salary1_1);
    salary1 = salary1_1;
    let employee = await payroll.getEmployee(employeeId);
    assert.equal(employee[0], employee1_1, "Employee account doesn't match");
    assert.equal(employee[1].toString(), convertAndRoundSalary(salary1_1).toString(), "Employee salary doesn't match");
    assert.equal(employee[2], name, "Employee name doesn't match");
  });

  it("fails adding again same employee", async () => {
    return assertRevert(async () => {
      await payroll.addEmployee(employee1_1, salary1_1);
    });
  });

  it("adds employee with name", async () => {
    let name = 'Joe';
    let employeeId = 2;
    await payroll.addEmployeeWithName(employee2, salary2_1, name);
    salary2 = salary2_1;
    let employee = await payroll.getEmployee(employeeId);
    assert.equal(employee[0], employee2, "Employee account doesn't match");
    assert.equal(employee[1].toString(), convertAndRoundSalary(salary2_1).toString(), "Employee salary doesn't match");
    assert.equal(employee[2], name, "Employee name doesn't match");
  });

  it("removes employee (no time passed since 'last allocation')", async () => {
    // therefore, no salary owed
    let employeeId = 2;
    await payroll.determineAllocation([usdToken.address], [100], {from: employee2});
    let initialBalance = await usdToken.balanceOf(employee2);
    await payroll.removeEmployee(employeeId);
    salary2 = 0;
    let finalBalance = await usdToken.balanceOf(employee2);
    assert.equal(finalBalance.toString(), initialBalance.toString());
    let employee = await payroll.getEmployee(employeeId);
    assert.equal(parseInt(employee[0], 16), 0, "Employee not properly removed");
  });

  it("adds employee again with name and start date", async () => {
    let name = 'Joe';
    let employeeId = 3;
    await payroll.addEmployeeWithNameAndStartDate(employee2, salary2_1, name, Math.floor((new Date()).getTime() / 1000) - 2628600);
    salary2 = salary2_1;
    let employee = await payroll.getEmployee(employeeId);
    assert.equal(employee[0], employee2, "Employee account doesn't match");
    assert.equal(employee[1].toString(), convertAndRoundSalary(salary2_1).toString(), "Employee salary doesn't match");
    assert.equal(employee[2], name, "Employee name doesn't match");
  });

  it("removes employee with remaining payroll", async () => {
    let employeeId = 3;
    await payroll.determineAllocation([usdToken.address], [100], {from: employee2});
    let initialBalance = await usdToken.balanceOf(employee2);
    let timePassed = await getTimePassed(employeeId);
    let owed = salary2.dividedToIntegerBy(SECONDS_IN_A_YEAR).times(timePassed);
    await payroll.removeEmployee(employeeId);
    salary2 = 0;
    let finalBalance = await usdToken.balanceOf(employee2);
    assert.equal(finalBalance.toString(), initialBalance.add(owed).toString());
  });

  it("fails on removing non-existent employee", async () => {
    let employeeId = 1;
    return assertRevert(async () => {
      await payroll.removeEmployee(10);
    });
  });

  it("adds removed employee again (with name and start date)", async () => {
    let name = 'John';
    let employeeId = 4;
    let transaction = await payroll.addEmployeeWithNameAndStartDate(employee2, salary2_2, name, Math.floor((new Date()).getTime() / 1000) - 2628600);
    let employee = await payroll.getEmployee(employeeId);
    assert.equal(employee[0], employee2, "Employee account doesn't match");
    assert.equal(employee[1].toString(), convertAndRoundSalary(salary2_2).toString(), "Employee salary doesn't match");
    assert.equal(employee[2], name, "Employee name doesn't match");
    salary2 = salary2_2;
  });

  it("modifies employee salary", async () => {
    let employeeId = 1;
    await payroll.setEmployeeSalary(employeeId, salary1_2);
    salary1 = salary1_2;
    let employee = await payroll.getEmployee(employeeId);
    assert.equal(employee[1].toString(), convertAndRoundSalary(salary1_2).toString(), "Salary doesn't match");
  });

  it("fails modifying non-existent employee salary", async () => {
    let employeeId = 1;
    return assertRevert(async () => {
      await payroll.setEmployeeSalary(10, salary1_2);
    });
  });

  it("fails modifying employee account address by Employee, for already existent account", async () => {
    let account_old = employee1;
    let account_new = employee2;
    return assertRevert(async () => {
      await payroll.changeAddressByEmployee(account_new, {from: account_old});
    });
  });

  it("fails modifying employee account address by Employee, for null account", async () => {
    let account_old = employee1;
    let account_new = "0x0";
    return assertRevert(async () => {
      await payroll.changeAddressByEmployee(account_new, {from: account_old});
    });
  });

  it("fails modifying employee account address by non Employee", async () => {
    let account_new = employee1_2;
    return assertRevert(async () => {
      await payroll.changeAddressByEmployee(account_new, {from: unused_account});
    });
  });

  it("modifies employee account address by Employee", async () => {
    let account_old = employee1_1;
    let account_new = employee1_2;
    let employeeId = 1;
    await payroll.changeAddressByEmployee(account_new, {from: account_old});
    let employee = await payroll.getEmployee(employeeId);
    assert.equal(employee[0], account_new, "Employee account doesn't match");
    employee1 = employee1_2;
  });

  it("sends tokens using approveAndCall and transferAndCall", async () => {
    // ERC20
    const amount = new web3.BigNumber(10**2).times(new web3.BigNumber(10**erc20Token1Decimals));
    let sender = owner;
    let receiver;
    let initialSenderBalance;
    let initialVaultBalance;

    const setInitial = async (token, _receiver) => {
      receiver = _receiver;
      initialSenderBalance = await token.balanceOf(sender);
      initialVaultBalance = await token.balanceOf(vault.address);
    };
    const checkFinal = async (token) => {
      assert.equal((await token.balanceOf(sender)).toString(), initialSenderBalance.toString(), "Sender balances don't match");
      assert.equal((await token.balanceOf(vault.address)).toString(), (new web3.BigNumber(initialVaultBalance).plus(amount)).toString(), "Vault balances don't match");
    };

    // Send ERC20 Tokens to Payroll (with direct transfer)
    await setInitial(erc20Token1, payroll.address);
    await erc20Token1.generateTokens(sender, amount);
    await erc20Token1.transfer(receiver, amount, {from: sender});
    await payroll.depositToFinance(erc20Token1.address);
    await checkFinal(erc20Token1);
  });

  it("fails on payday with no token allocation", async () => {
    payroll2 = await Payroll.new();
    await payroll2.initialize(finance.address, usdToken.address, priceFeed.address, rateExpiryTime);
    // add allowed tokens
    await addAllowedTokens(payroll2, [usdToken, erc20Token1])
    // make sure this payroll has enough funds
    let etherFunds = new web3.BigNumber(90).times(10**18);
    let usdTokenFunds = new web3.BigNumber(10**9).times(USD_PRECISION);
    let erc20Token1Funds = new web3.BigNumber(10**9).times(10**erc20Token1Decimals);
    await usdToken.generateTokens(owner, usdTokenFunds);
    await erc20Token1.generateTokens(owner, erc20Token1Funds);
    // Send funds to Finance
    await finance.sendTransaction( {from: owner, value: etherFunds} );
    await usdToken.approve(finance.address, usdTokenFunds, {from: owner});
    await finance.deposit(usdToken.address, usdTokenFunds, "USD payroll", {from: owner});
    await erc20Token1.approve(finance.address, erc20Token1Funds, {from: owner});
    await finance.deposit(erc20Token1.address, erc20Token1Funds, "ERC20 1 payroll", {from: owner});
    // Add employee
    await payroll2.addEmployeeWithNameAndStartDate(employee1_1, salary1_1, "", Math.floor((new Date()).getTime() / 1000) - 2628005); // now minus 1/12 year
    // No Token allocation
    return assertRevert(async () => {
      await payroll2.payday({from: employee1_1});
    });
  });

  it("fails on payday with a zero exchange rate token", async () => {
    let priceFeedFail = await PriceFeedFailMock.new();
    await payroll2.setPriceFeed(priceFeedFail.address)
    // Allocation
    await payroll2.determineAllocation([ETH, usdToken.address, erc20Token1.address], [10, 20, 70], {from: employee1_1});
    // Zero exchange rate
    return assertRevert(async () => {
      await payroll2.payday({from: employee1_1});
    });
  });

  it("fails on payday by non-employee", async () => {
    // should throw as caller is not an employee
    return assertRevert(async () => {
      await payroll2.payday({from: unused_account});
    });
  });

  it("fails on payday after 0 seconds", async () => {
    // correct priceFeed, make sure rates are correct
    await payroll2.setPriceFeed(priceFeed.address)
    // correct payday
    await payroll2.payday({from: employee1_1});
    // payday called again too early: if 0 seconds have passed, payroll would be 0
    return assertRevert(async () => {
      await payroll2.payday({from: employee1_1});
    });
  });

  it("sends funds to Finance", async () => {
    let totalTxFee = new web3.BigNumber(0);;
    let vaultTokenBalances = {};
    let payrollTokenBalances = {};

    const getTxFee = async (transaction) => {
      let tx = await getTransaction(transaction.tx);
      let gasPrice = new web3.BigNumber(tx.gasPrice);
      let txFee = gasPrice.times(transaction.receipt.cumulativeGasUsed);

      return new Promise(resolve => {resolve(txFee);});
    };
    const addInitialBalance = async (token, name="", generate=true, decimals=18) => {
      let txFee = new web3.BigNumber(0);
      // add some tokens to Payroll (it shouldn't happen, but to test it)
      if (generate) {
        const amount = new web3.BigNumber(10**2).times(new web3.BigNumber(10**decimals));
        let transaction1 = await token.generateTokens(owner, amount);
        txFee = txFee.plus(await getTxFee(transaction1));
        let transaction2 = await token.transfer(payroll2.address, amount, {from: owner});
        txFee = txFee.plus(await getTxFee(transaction2));
      }

      let vaultBalance = await token.balanceOf(vault.address);
      let payrollBalance = await token.balanceOf(payroll2.address);
      vaultTokenBalances[token.address] = vaultBalance;
      payrollTokenBalances[token.address] = payrollBalance;

      return new Promise(resolve => {resolve(txFee);});
    };
    const checkFinalBalance = async (token, name="") => {
      let vaultBalance = await token.balanceOf(vault.address);
      let payrollBalance = await token.balanceOf(payroll2.address);
      assert.equal(vaultBalance.toString(), vaultTokenBalances[token.address].add(payrollTokenBalances[token.address]).toString(), "Funds not recovered for " + name + " (Vault)!");
      assert.equal(payrollBalance.valueOf(), 0, "Funds not recovered for " + name + " (Payroll)!");
    };

    // Initial values
    let transaction;
    let vaultInitialBalance = await getBalance(vault.address);
    totalTxFee = totalTxFee.plus(await addInitialBalance(usdToken, "USD Token", USD_DECIMALS));
    totalTxFee = totalTxFee.plus(await addInitialBalance(erc20Token1, "ERC20 Token 1", erc20Token1Decimals));
    // Escape Hatch
    transaction = await payroll2.depositToFinance(usdToken.address);
    totalTxFee = totalTxFee.plus(await getTxFee(transaction));
    transaction = await payroll2.depositToFinance(erc20Token1.address);
    totalTxFee = totalTxFee.plus(await getTxFee(transaction));
    // Final check
    await checkFinalBalance(usdToken, "USD Token");
    await checkFinalBalance(erc20Token1, "ERC20 Token 1");
    // call again to make sure we test value == 0 condition
    await payroll2.depositToFinance(usdToken.address);
  });

  it("fails on sending ETH funds to Payroll", async () => {
    return assertRevert(async () => {
      await payroll2.sendTransaction({ from: owner, value: web3.toWei(200, 'wei') });
    });
  });

  it("escapes hatch, recovers ETH", async () => {
    // Payroll doesn't accept ETH funds, so we use a self destructing contract
    // as a trick to be able to send ETH to it.
    let zombie = await Zombie.new(payroll2.address);
    await zombie.sendTransaction({ from: owner, value: web3.toWei(200, 'wei') });
    await zombie.escapeHatch();
    let vaultInitialBalance = await getBalance(vault.address);
    let payrollInitialBalance = await getBalance(payroll2.address);
    await payroll2.escapeHatch();
    let vaultFinalBalance = await getBalance(vault.address);
    let payrollFinalBalance = await getBalance(payroll2.address);
    assert.equal(payrollFinalBalance.valueOf(), 0, "Funds not recovered (Payroll)!");
    assert.equal(vaultFinalBalance.toString(), vaultInitialBalance.add(payrollInitialBalance).toString(), "Funds not recovered (Vault)!");
  });

  it("fails on Token allocation if greater than 100", async () => {
    // should throw as total allocation is greater than 100
    return assertRevert(async () => {
      await payroll.determineAllocation([ETH, usdToken.address, erc20Token1.address], [20, 30, 90], {from: employee1});
    });
  });

  it("fails on Token allocation because of overflow", async () => {
    // should throw as total allocation overflow
    return assertRevert(async () => {
      await payroll.determineAllocation([ETH, usdToken.address, erc20Token1.address], [120, 100, 90], {from: employee1});
    });
  });

  it("fails on Token allocation if lower than 100", async () => {
    // should throw as total allocation is lower than 100
    return assertRevert(async () => {
      await payroll.determineAllocation([ETH, usdToken.address, erc20Token1.address], [5, 30, 40], {from: employee1});
    });
  });

  it("fails on Token allocation for not allowed token", async () => {
    // should throw as it's not an allowed token
    return assertRevert(async () => {
      await payroll.determineAllocation([payroll.address, usdToken.address, erc20Token1.address], [10, 20, 70], {from: employee1});
    });
  });

  it("fails on Token allocation by non-employee", async () => {
    // should throw as caller is not an employee
    return assertRevert(async () => {
      await payroll.determineAllocation([ETH, usdToken.address, erc20Token1.address], [10, 20, 70], {from: unused_account});
    });
  });

  it("fails on Token allocation if arrays mismatch", async () => {
    // should throw as arrays sizes are different
    return assertRevert(async () => {
      await payroll.determineAllocation([ETH, usdToken.address, erc20Token1.address], [10, 90], {from: employee1});
    });
  });

  it("tests payday", async () => {
    let usdTokenAllocation = 50;
    let erc20Token1Allocation = 20;
    let ethAllocation = 100 - usdTokenAllocation - erc20Token1Allocation;
    let initialEthPayroll;
    let initialUsdTokenPayroll;
    let initialErc20Token1Payroll;
    let initialEthEmployee2;
    let initialUsdTokenEmployee2;
    let initialErc20Token1Employee2;

    const setInitialBalances = async () => {
      initialEthPayroll = await getBalance(vault.address);
      initialEthEmployee2 = await getBalance(employee2);
      // Token initial balances
      initialUsdTokenPayroll = await usdToken.balanceOf(vault.address);
      initialErc20Token1Payroll = await erc20Token1.balanceOf(vault.address);
      initialUsdTokenEmployee2 = await usdToken.balanceOf(employee2);
      initialErc20Token1Employee2 = await erc20Token1.balanceOf(employee2);
    };

    const logPayroll = function(salary, initialBalancePayroll, initialBalanceEmployee, payed, newBalancePayroll, newBalanceEmployee, expectedPayroll, expectedEmployee, name='') {
      console.log("");
      console.log("Checking " + name);
      console.log("Salary: " + salary);
      console.log("-------------------")
      console.log("Initial " + name + " Payroll: " + web3.fromWei(initialBalancePayroll, 'ether'));
      console.log("Initial " + name + " Employee: " + web3.fromWei(initialBalanceEmployee, 'ether'));
      console.log("-------------------")
      console.log("Payed: " + web3.fromWei(payed, 'ether'));
      console.log("-------------------")
      console.log("new " + name + " payroll: " + web3.fromWei(newBalancePayroll, 'ether'));
      console.log("expected " + name + " payroll: " + web3.fromWei(expectedPayroll, 'ether'));
      console.log("New " + name + " employee: " + web3.fromWei(newBalanceEmployee, 'ether'));
      console.log("Expected " + name + " employee: " + web3.fromWei(expectedEmployee, 'ether'));
      console.log("-------------------")
      console.log("Real payed: " + web3.fromWei(initialBalancePayroll.minus(newBalancePayroll), 'ether'))
      console.log("Real earned: " + web3.fromWei(newBalanceEmployee.minus(initialBalanceEmployee), 'ether'))
      console.log("");
    };

    const checkTokenBalances = async (token, salary, timePassed, initialBalancePayroll, initialBalanceEmployee, exchangeRate, allocation, name='') => {
      let payed = salary.dividedToIntegerBy(SECONDS_IN_A_YEAR).times(exchangeRate).times(allocation).times(timePassed).dividedToIntegerBy(100).dividedToIntegerBy(ONE)
      let expectedPayroll = initialBalancePayroll.minus(payed);
      let expectedEmployee = initialBalanceEmployee.plus(payed);
      let newBalancePayroll;
      let newBalanceEmployee;
      newBalancePayroll = await token.balanceOf(vault.address);
      newBalanceEmployee = await token.balanceOf(employee2);
      //logPayroll(salary, initialBalancePayroll, initialBalanceEmployee, payed, newBalancePayroll, newBalanceEmployee, expectedPayroll, expectedEmployee, name);
      assert.equal(newBalancePayroll.toString(), expectedPayroll.toString(), "Payroll balance of Token " + name + " doesn't match");
      assert.equal(newBalanceEmployee.toString(), expectedEmployee.toString(), "Employee balance of Token " + name + " doesn't match");
    };

    const checkPayday = async (transaction, timePassed) => {
      // Check ETH
      let tx = await getTransaction(transaction.tx);
      let gasPrice = new web3.BigNumber(tx.gasPrice);
      let txFee = gasPrice.times(transaction.receipt.cumulativeGasUsed);
      let newEthPayroll = await getBalance(vault.address);
      let newEthEmployee2 = await getBalance(employee2);
      let payed = salary2.dividedToIntegerBy(SECONDS_IN_A_YEAR).times(etherExchangeRate).times(ethAllocation).times(timePassed).dividedToIntegerBy(100).dividedToIntegerBy(ONE)
      let expectedPayroll = initialEthPayroll.minus(payed);
      let expectedEmployee2 = initialEthEmployee2.plus(payed).minus(txFee);
      //logPayroll(salary2, initialEthPayroll, initialEthEmployee2, payed, newEthPayroll, newEthEmployee2, expectedPayroll, expectedEmployee2, "ETH");
      assert.equal(newEthPayroll.toString(), expectedPayroll.toString(), "Payroll Eth Balance doesn't match");
      assert.equal(newEthEmployee2.toString(), expectedEmployee2.toString(), "Employee Eth Balance doesn't match");
      // Check Tokens
      await checkTokenBalances(usdToken, salary2, timePassed, initialUsdTokenPayroll, initialUsdTokenEmployee2, ONE, usdTokenAllocation, "USD");
      await checkTokenBalances(erc20Token1, salary2, timePassed, initialErc20Token1Payroll, initialErc20Token1Employee2, erc20Token1ExchangeRate, erc20Token1Allocation, "ERC20 1");
    };

    // determine allocation
    await payroll.determineAllocation([ETH, usdToken.address, erc20Token1.address], [ethAllocation, usdTokenAllocation, erc20Token1Allocation], {from: employee2});
    await setInitialBalances();
    let employeeId = 4;
    let timePassed = await getTimePassed(employeeId); // get employee 2
    // call payday
    let transaction = await payroll.payday({from: employee2});
    await checkPayday(transaction, timePassed);

    // check that we can call payday again after some time
    // set time forward, 1 month
    let newTime = parseInt(await payroll.getTimestampPublic(), 10) + 2678400; // 31 * 24 * 3600
    await payroll.mockSetTimestamp(newTime);
    // we need to forward time in price feed, or rate will be obsolete
    await priceFeed.mockSetTimestamp(newTime);
    await setInitialBalances();
    timePassed = await getTimePassed(employeeId); // get employee 2
    // call payday again
    let transaction2 = await payroll.payday({from: employee2});
    await checkPayday(transaction2, timePassed);

    // check that time restriction for determineAllocation works in a positive way (i.e. when time has gone by)
    // set time forward, 5 more months
    let newTime2 = parseInt(await payroll.getTimestampPublic(), 10) + 13392000; // 5 * 31 * 24 * 3600
    await payroll.mockSetTimestamp(newTime2)
    // we need to forward time in price feed, or rate will be obsolete
    await priceFeed.mockSetTimestamp(newTime2);
    await payroll.determineAllocation([ETH, usdToken.address, erc20Token1.address], [15, 60, 25], {from: employee2});
    assert.equal((await payroll.getAllocation(ETH, {from: employee2})).valueOf(), 15, "ETH allocation doesn't match");
    assert.equal((await payroll.getAllocation(usdToken.address, {from: employee2})).valueOf(), 60, "USD allocation doesn't match");
    assert.equal((await payroll.getAllocation(erc20Token1.address, {from: employee2})).valueOf(), 25, "ERC 20 Token 1 allocation doesn't match");
  });

  it('fails to pay if rates are obsolete', async () => {
    const usdTokenAllocation = 50;
    const erc20Token1Allocation = 20;
    const ethAllocation = 100 - usdTokenAllocation - erc20Token1Allocation;
    // determine allocation
    await payroll.determineAllocation([ETH, usdToken.address, erc20Token1.address], [ethAllocation, usdTokenAllocation, erc20Token1Allocation], {from: employee2});
    const employeeId = 4;
    await getTimePassed(employeeId); // get employee 2
    // set old date in price feed
    const oldTime = parseInt(await payroll.getTimestampPublic(), 10) - rateExpiryTime - 1
    await priceFeed.mockSetTimestamp(oldTime)
    // call payday
    return assertRevert(async () => {
      await payroll.payday({from: employee2});
    })

  })

  it('fails to change the price feed time to 0', async () => {
    return assertRevert(async () => {
      await payroll.setPriceFeed('0x0');
    })
  })

  it('changes the rate expiry time', async () => {
    const newTime = rateExpiryTime * 2;
    await payroll.setRateExpiryTime(newTime);
    assert.equal(await payroll.rateExpiryTime(), newTime);
  })

  it('fails to change the rate expiry time to 0', async () => {
    const newTime = 0;
    return assertRevert(async () => {
      await payroll.setRateExpiryTime(newTime);
    })
  })
});

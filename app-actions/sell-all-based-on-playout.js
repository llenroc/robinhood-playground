// steps
// 1. get list of current positions
// 2. look within the daily-transactions and find which day that stock was bought and which strategy was responsible for the purchase
// 3. look at the strat-perfs for the transaction
// 4. run the playoutFn (strategy-perf-multiple) related to the current settings.js fallbackSellStrategy on that list of breakdowns
// 5. sell all that are > 4 days old or the output of playoutFn shows that it hit the playout at some point


const fs = require('mz/fs');
const mapLimit = require('promise-map-limit');

// utils
const jsonMgr = require('../utils/json-mgr');
const getFilesSortedByDate = require('../utils/get-files-sorted-by-date');
const getTrend = require('../utils/get-trend');

// app-actions
const detailedNonZero = require('./detailed-non-zero');
const activeSell = require('./active-sell');

// the magic
const {
  fallbackSellStrategy,
  sellAllStocksOnNthDay,
  force: { sell: forceSell }
} = require('../settings');
const playouts = require('../analysis/strategy-perf-multiple/playouts');

const determineSingleBestPlayoutFromMultiOutput = require(
    '../analysis/strategy-perf-multiple/one-off-scripts/determine-best-playout'
);

const getStratPerfTrends = async (ticker, buyDate, strategy) => {
    try {
        const stratPerfObj = await jsonMgr.get(`./json/strat-perfs/${buyDate}.json`);
        const trends = [];
        Object.keys(stratPerfObj).forEach(key => {
            const foundPerf = stratPerfObj[key].find(obj => obj.strategyName === strategy);
            if (foundPerf) {
                trends.push(
                    foundPerf.avgTrend
                );
            }
        });
        return trends;
    } catch (e) {
        return null;
    }
};

// do it

module.exports = async (Robinhood, dontActuallySellFlag) => {

    // helper action fns
    const sellPosition = async ({ ticker, quantity }, whySelling) => {
        try {
            console.log(`selling ${ticker} because ${whySelling}`);
            if (dontActuallySellFlag) return;
            const response = await activeSell(
                Robinhood,
                { ticker, quantity }
            );
            console.log(`sold ${quantity} shares of ${ticker} because ${whySelling}`, response);
        } catch (e) {
            console.log(`error selling ${ticker} because ${whySelling}`, e);
        }
    };

    const dailyTransactionDates = await getFilesSortedByDate('daily-transactions');
    // console.log(dailyTransactionDates, 'dailyTransactionDates');
    // console.log(pmModelDates, 'pmModelDates');

    let nonzero = await detailedNonZero(Robinhood);

    const forceSells = nonzero.filter(pos => forceSell.includes(pos.symbol));
    nonzero = nonzero.filter(pos => !forceSell.includes(pos.symbol));

    await mapLimit(forceSells, 2, async pos => {
        await sellPosition({
            ticker: pos.symbol,
            quantity: pos.quantity
        }, `on force sell list in settings.js`);
    });

    // console.log(nonzero.length);

    nonzero.forEach(pos => {
        console.log(
            pos.symbol,
            pos.dayAge + ' days old'
        );
    });


    const handleOverNDays = async () => {
        // handle older than four days
        const olderThanNDays = nonzero.filter(pos => pos.dayAge >= sellAllStocksOnNthDay);
        await mapLimit(olderThanNDays, 3, async pos => {
            await sellPosition({
                ticker: pos.symbol,
                quantity: pos.quantity
            }, `older than ${sellAllStocksOnNthDay} days: ${pos.dayAge}`);
        });
    };

    const handleUnderNDays = async () => {
        // handle under four days (but not bought today) check for playout strategy
        let underNDays = nonzero.filter(pos => pos.dayAge >= 1 && pos.dayAge < sellAllStocksOnNthDay);
        if (!underNDays.length) return;
        // console.log({ underNDays });
        const strategiesToLookup = underNDays.map(pos => pos.strategy).filter(v => !!v);
        const highestPlayouts = strategiesToLookup.length ?
            await determineSingleBestPlayoutFromMultiOutput(
                Robinhood,
                ...strategiesToLookup
            ) : [];
        // console.log(highestPlayouts, 'highestPlayouts')
        underNDays = underNDays.map(pos => {
            const foundMatch = highestPlayouts.find(obj => obj.strategy === pos.strategy);
            return {
                ...pos,
                ...(foundMatch && { highestPlayout: foundMatch.highestPlayout })
            };
        });

        // console.log('underNDays', underNDays);
        for (let pos of underNDays) {
            // const strategy = await findStrategyThatPurchasedTicker(pos.symbol);
            const breakdowns = await getStratPerfTrends(pos.ticker, pos.date, pos.strategy) || [];
            if (!breakdowns.length) {
                breakdowns.push(
                    getTrend(
                        pos.currentPrice,
                        pos.average_buy_price
                    )
                );
            }
            const playoutToRun = pos.highestPlayout || fallbackSellStrategy;
            pos.playoutToRun = playoutToRun;
            const playoutFn = playouts[playoutToRun].fn;
            const { hitFn: hitPlayout } = playoutFn(breakdowns);
            pos.hitPlayout = hitPlayout;
            console.log(pos.ticker, breakdowns, 'playout', playoutToRun, 'hitPlayout', hitPlayout);
        }

        // sell all under 4 days that hit the playoutFn
        await mapLimit(underNDays.filter(pos => pos.hitPlayout), 3, async pos => {
            await sellPosition(pos, `hit ${pos.playoutToRun} playout`);
        });
    };

    await Promise.all([
        handleOverNDays(),
        handleUnderNDays()
    ]);



};

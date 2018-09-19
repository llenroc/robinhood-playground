// starts attempting to buy at 100% of current stock price
// every attempt it goes up from there until it successfully gets sold or it reaches MAX_BUY_RATIO

const limitBuyLastTrade = require('../rh-actions/limit-buy-last-trade');
const jsonMgr = require('../utils/json-mgr');

const lookup = require('../utils/lookup');
const mapLimit = require('promise-map-limit');

const TIME_BETWEEN_CHECK = 10; // seconds
const TOTAL_ATTEMPTS = 6;

const addToDailyTransactions = async data => {
    const fileName = `./json/daily-transactions/${(new Date()).toLocaleDateString().split('/').join('-')}.json`;
    const curTransactions = await jsonMgr.get(fileName) || [];
    curTransactions.push(data);
    await jsonMgr.save(fileName, curTransactions);
};

const calcQuantity = (maxPrice, bidPrice) => {
    let quantity = Math.floor(maxPrice / bidPrice);
    if (quantity === 0 && bidPrice < 50) {
        quantity = 1;
    }
    return quantity;
};

const preOrPostMarketBuy = async ({
    ticker,
    strategy,
    maxPrice,
}) => {
    const { afterHoursPrice } = await lookup(Robinhood, ticker);
    const bidPrice = afterHoursPrice;
    const quantity = calcQuantity(maxPrice, bidPrice);
    const data = {
        ticker,
        bidPrice,
        quantity,
        strategy
    };
    console.log('pre or post market buy', data);
    return await limitBuyLastTrade(
        Robinhood,
        data
    );
};

module.exports = async (
    Robinhood,
    {
        ticker,
        strategy,   // strategy name
        maxPrice,   // total amount to spend
        min
    }
) => {

    if (min < 0 || min > 390) {
        return preOrPostMarketBuy({
            ticker,
            strategy,
            maxPrice,
        });
    }

    return new Promise(async (resolve, reject) => {


        try {

            let attemptCount = 0;

            // maxPrice = Math.min(maxPrice, 35);


            const attempt = async () => {

                attemptCount++;
                console.log('attempting ', attemptCount, ticker);


                // if (!quantity) {
                //     console.log('maxPrice below bidPrice but ', maxPrice, bidPrice, ticker);
                //     return reject('maxPrice below bidPrice');
                // }
                let lastBidPrice;
                let quantity;
                const limitBid = async bidPrice => {
                    lastBidPrice = bidPrice;
                    const quantity = calcQuantity(maxPrice, bidPrice);
                    const data = {
                        ticker,
                        bidPrice,
                        quantity,
                        strategy
                    };
                    console.log({ data, maxPrice });
                    return await limitBuyLastTrade(
                        Robinhood,
                        data
                    );

                };

                const attemptLimitOrder = async () => {
                    const { askPrice, bidPrice } = await lookup(Robinhood, ticker);
                    const spread = askPrice - bidPrice;
                    const aboveBid = spread * (attemptCount - 1) / (TOTAL_ATTEMPTS - 1);
                    const attemptPrice = bidPrice + aboveBid;
                    console.log({
                        askPrice,
                        bidPrice,
                        spread,
                        aboveBid,
                        attemptPrice
                    })
                    return await limitBid(attemptPrice);
                };

                let res = await attemptLimitOrder();

                if (!res || res.detail) {
                    return reject(res.detail || 'unable to purchase' + ticker);
                }

                if (res && res.non_field_errors && res.non_field_errors.length && res.non_field_errors[0].includes('increments of $0.05')) {
                    const nearestFiveCents = num => {
                        return Math.ceil(num * 20) / 20;
                    };
                    const newBid = nearestFiveCents(lastBidPrice);
                    console.log('5 center!!!');
                    console.log('new bid', newBid);
                    res = await limitBid(newBid);
                }

                const timeout = ((0.8 * TIME_BETWEEN_CHECK) + (Math.random() * TIME_BETWEEN_CHECK * 0.8)) * 1000;
                setTimeout(async () => {

                    // get orders, check if still pending
                    let {results: orders} = await Robinhood.orders();
                    orders = orders.filter(order => ['filled', 'cancelled'].indexOf(order.state) === -1);

                    orders = await mapLimit(orders, 1, async order => ({
                        ...order,
                        instrument: await Robinhood.url(order.instrument)
                    }));

                    const relOrder = orders.find(order => {
                        return order.instrument.symbol === ticker;
                    });
                    // console.log(relOrder);
                    if (relOrder) {
                        console.log('canceling last attempt', ticker);
                        await Robinhood.cancel_order(relOrder);
                        if (attemptCount < TOTAL_ATTEMPTS) {
                            return attempt();
                        } else {
                            const errMessage = 'reached max attempts, unable to BUY';
                            console.log(errMessage, ticker);
                            return reject(errMessage);
                        }
                    } else {

                        // update daily transactions
                        const successObj = {
                            type: 'buy',
                            ticker,
                            bid_price: lastBidPrice,
                            quantity,
                            strategy,
                            min
                        };
                        await addToDailyTransactions(successObj);

                        if (attemptCount) {
                            console.log('successfully bought with attemptcount', attemptCount, ticker);
                        }

                        return resolve(successObj);

                    }
                }, timeout);

            };

            attempt();

        } catch (e) {
            return reject(e.toString());
        }

    });


};

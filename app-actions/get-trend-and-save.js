const getTrendSinceOpen = require('../rh-actions/get-trend-since-open');
const jsonMgr = require('../utils/json-mgr');
const getMinutesFrom630 = require('../utils/get-minutes-from-630');

const getAllTickers = require('../rh-actions/get-all-tickers');

const getTrendAndSave = async (Robinhood, min) => {

    min = min || getMinutesFrom630();

    // step 1 - get all tickers
    try {
        var allTickers = require('../json/stock-data/allStocks');
    } catch (e) {
        allTickers = await getAllTickers(Robinhood);
    }
    allTickers = allTickers
        .filter(stock => stock.tradeable && stock.tradability === 'tradable')
        .map(stock => stock.symbol);

    // step 2 - get trend
    console.log(`getting trend since open for all stocks - 6:31am + ${min} minutes`);
    const trendingArray = await getTrendSinceOpen(Robinhood, allTickers);
    const dateStr = (new Date()).toLocaleString().split('/').join('-').split(',').join('');

    // step 3 - save trend
    await jsonMgr.save(`./json/stock-data/${dateStr} (+${min}).json`, trendingArray);
    console.log('done getting trend');

    return trendingArray;

};

module.exports = getTrendAndSave;

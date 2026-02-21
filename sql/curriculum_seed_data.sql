-- ============================================================
-- Financial Education Curriculum - Seed Data
-- ============================================================
-- This file contains all 86 modules (12 beginner + 24 intermediate + 50 advanced)
-- Run this AFTER curriculum_migration.sql
-- ============================================================

-- ============================================================
-- BEGINNER MODULES (12)
-- ============================================================

INSERT INTO public.education_bank (module_code, level, track_or_pathway, title, summary, learning_objective, estimated_minutes, tags, display_order, is_active, status) VALUES
('B1', 'beginner', NULL, 'What Does Finance Actually Do?', 'Introduction to the fundamental purpose and role of finance in personal and business contexts.', 'Understand what finance is, why it matters, and how it affects daily life and business decisions.', 15, ARRAY['basics', 'introduction', 'fundamentals'], 1, TRUE, 'published'),
('B2', 'beginner', NULL, 'Time is Money: The Power of Compounding', 'Learn how time and compound interest work together to grow wealth over long periods.', 'Calculate compound interest, understand time value of money, and see the impact of starting early.', 20, ARRAY['compounding', 'time-value', 'interest'], 2, TRUE, 'published'),
('B3', 'beginner', NULL, 'The Big 4 Asset Classes', 'Overview of stocks, bonds, real estate, and cash as the four primary investment categories.', 'Identify and understand the characteristics, risks, and returns of each major asset class.', 18, ARRAY['asset-classes', 'diversification', 'basics'], 3, TRUE, 'published'),
('B4', 'beginner', NULL, 'Risk vs. Return: The Golden Rule', 'The fundamental relationship between investment risk and potential returns.', 'Understand that higher returns typically require accepting higher risk, and how to assess your risk tolerance.', 15, ARRAY['risk', 'return', 'fundamentals'], 4, TRUE, 'published'),
('B5', 'beginner', NULL, 'Diversification: Don''t Put All Eggs in One Basket', 'Learn why spreading investments across different assets reduces risk without sacrificing returns.', 'Apply diversification principles to build a balanced portfolio and reduce overall risk.', 20, ARRAY['diversification', 'portfolio', 'risk-management'], 5, TRUE, 'published'),
('B6', 'beginner', NULL, 'Stocks 101: Owning a Piece of a Company', 'Introduction to stocks, how they work, and what it means to be a shareholder.', 'Understand stock ownership, dividends, stock prices, and basic stock market mechanics.', 25, ARRAY['stocks', 'equity', 'basics'], 6, TRUE, 'published'),
('B7', 'beginner', NULL, 'Bonds 101: Lending Your Money', 'Learn about bonds as loans to companies or governments, and how they generate income.', 'Understand bond basics: principal, interest, maturity, credit risk, and bond pricing.', 25, ARRAY['bonds', 'fixed-income', 'basics'], 7, TRUE, 'published'),
('B8', 'beginner', NULL, 'Funds, ETFs & Managed Products', 'Introduction to mutual funds, ETFs, and other managed investment products.', 'Compare different fund types, understand fees, and know when to use funds vs. individual stocks.', 20, ARRAY['funds', 'etf', 'managed-products'], 8, TRUE, 'published'),
('B9', 'beginner', NULL, 'Reading a Company''s Report Card', 'Learn to read and understand basic financial statements: income statement, balance sheet, cash flow.', 'Identify key financial metrics and understand what they tell you about a company''s health.', 30, ARRAY['financial-statements', 'analysis', 'basics'], 9, TRUE, 'published'),
('B10', 'beginner', NULL, 'Inflation & Real Returns', 'Understand how inflation erodes purchasing power and why real returns matter more than nominal returns.', 'Calculate real returns, understand inflation impact, and adjust expectations accordingly.', 18, ARRAY['inflation', 'real-returns', 'economics'], 10, TRUE, 'published'),
('B11', 'beginner', NULL, 'Fees & Costs: The Silent Killer', 'Learn how investment fees compound over time and significantly impact long-term returns.', 'Identify all types of fees, calculate their true cost, and minimize fee drag on returns.', 20, ARRAY['fees', 'costs', 'expenses'], 11, TRUE, 'published'),
('B12', 'beginner', NULL, 'Your First Portfolio: Asset Allocation Basics', 'Practical guide to building your first investment portfolio with proper asset allocation.', 'Create a diversified portfolio appropriate for your age, goals, and risk tolerance.', 25, ARRAY['portfolio', 'asset-allocation', 'practical'], 12, TRUE, 'published')
ON CONFLICT (module_code) DO UPDATE SET
    title = EXCLUDED.title,
    summary = EXCLUDED.summary,
    learning_objective = EXCLUDED.learning_objective,
    updated_at = NOW();

-- ============================================================
-- INTERMEDIATE MODULES - Track IA (6)
-- ============================================================

INSERT INTO public.education_bank (module_code, level, track_or_pathway, title, summary, learning_objective, estimated_minutes, tags, display_order, is_active, status, prerequisites) VALUES
('IA1', 'intermediate', 'IA', 'Statistics for Investors', 'Essential statistical concepts for investment analysis: mean, variance, correlation, and distributions.', 'Apply statistical tools to analyze investment returns, risk, and portfolio relationships.', 30, ARRAY['statistics', 'quantitative', 'analysis'], 1, TRUE, 'published', ARRAY['B4']),
('IA2', 'intermediate', 'IA', 'Expected Return & Risk Modeling', 'Build models to estimate expected returns and quantify investment risk using historical data.', 'Calculate expected returns, standard deviation, and build risk models for portfolio construction.', 35, ARRAY['risk-modeling', 'expected-return', 'quantitative'], 2, TRUE, 'published', ARRAY['IA1']),
('IA3', 'intermediate', 'IA', 'Sharpe Ratio & Risk-Adjusted Returns', 'Learn to measure risk-adjusted performance using Sharpe ratio and other metrics.', 'Calculate and interpret Sharpe ratio, understand risk-adjusted returns, and compare investment performance.', 25, ARRAY['sharpe-ratio', 'performance', 'risk-adjusted'], 3, TRUE, 'published', ARRAY['IA2']),
('IA4', 'intermediate', 'IA', 'Time Value Applications: Loans & Annuities', 'Apply time value of money to loans, mortgages, annuities, and retirement planning.', 'Calculate loan payments, mortgage amortization, and annuity values using TVM principles.', 30, ARRAY['time-value', 'loans', 'annuities'], 4, TRUE, 'published', ARRAY['B2']),
('IA5', 'intermediate', 'IA', 'Intro to Portfolio Math', 'Mathematical foundations of portfolio theory: covariance, correlation, and portfolio variance.', 'Calculate portfolio risk, understand diversification math, and optimize portfolio weights.', 35, ARRAY['portfolio-theory', 'mathematics', 'optimization'], 5, TRUE, 'published', ARRAY['IA2', 'B5']),
('IA6', 'intermediate', 'IA', 'Excel for Finance: Build Your First Model', 'Hands-on Excel training: build financial models, use formulas, and create dynamic calculations.', 'Build a working financial model in Excel with formulas, functions, and scenario analysis.', 40, ARRAY['excel', 'modeling', 'practical'], 6, TRUE, 'published', ARRAY['IA4'])
ON CONFLICT (module_code) DO UPDATE SET
    title = EXCLUDED.title,
    summary = EXCLUDED.summary,
    learning_objective = EXCLUDED.learning_objective,
    updated_at = NOW();

-- ============================================================
-- INTERMEDIATE MODULES - Track IB (6)
-- ============================================================

INSERT INTO public.education_bank (module_code, level, track_or_pathway, title, summary, learning_objective, estimated_minutes, tags, display_order, is_active, status, prerequisites) VALUES
('IB1', 'intermediate', 'IB', 'How Financial Markets Work', 'Deep dive into market structure, exchanges, order types, and market mechanics.', 'Understand how markets function, trading mechanisms, and the role of market participants.', 30, ARRAY['markets', 'trading', 'structure'], 1, TRUE, 'published', ARRAY['B6']),
('IB2', 'intermediate', 'IB', 'Macroeconomics & Your Portfolio', 'How economic indicators, monetary policy, and business cycles affect investments.', 'Link macroeconomic trends to portfolio performance and adjust strategy accordingly.', 35, ARRAY['macroeconomics', 'economics', 'portfolio'], 2, TRUE, 'published', ARRAY['B10']),
('IB3', 'intermediate', 'IB', 'Financial Statement Deep Dive', 'Advanced financial statement analysis: ratios, trends, and red flags.', 'Perform comprehensive financial analysis using ratios, trend analysis, and comparative metrics.', 40, ARRAY['financial-statements', 'analysis', 'ratios'], 3, TRUE, 'published', ARRAY['B9']),
('IB4', 'intermediate', 'IB', 'Stock Valuation: Multiples & Ratios', 'Learn valuation methods using P/E, P/B, EV/EBITDA, and other multiples.', 'Value companies using multiple-based approaches and understand when each method is appropriate.', 35, ARRAY['valuation', 'multiples', 'ratios'], 4, TRUE, 'published', ARRAY['IB3']),
('IB5', 'intermediate', 'IB', 'Intro to DCF Valuation', 'Introduction to discounted cash flow valuation: forecast cash flows and calculate present value.', 'Build a basic DCF model to value a company using projected cash flows.', 45, ARRAY['dcf', 'valuation', 'cash-flow'], 5, TRUE, 'published', ARRAY['IB4', 'IA4']),
('IB6', 'intermediate', 'IB', 'Bond Pricing & Yield Curves', 'Advanced bond concepts: pricing, yield calculations, duration, and yield curve analysis.', 'Price bonds, calculate yields, understand duration risk, and interpret yield curves.', 35, ARRAY['bonds', 'pricing', 'yield-curve'], 6, TRUE, 'published', ARRAY['B7'])
ON CONFLICT (module_code) DO UPDATE SET
    title = EXCLUDED.title,
    summary = EXCLUDED.summary,
    learning_objective = EXCLUDED.learning_objective,
    updated_at = NOW();

-- ============================================================
-- INTERMEDIATE MODULES - Track IC (6)
-- ============================================================

INSERT INTO public.education_bank (module_code, level, track_or_pathway, title, summary, learning_objective, estimated_minutes, tags, display_order, is_active, status, prerequisites) VALUES
('IC1', 'intermediate', 'IC', 'Strategic Asset Allocation', 'Long-term portfolio construction based on goals, time horizon, and risk tolerance.', 'Design and implement a strategic asset allocation plan for long-term wealth building.', 30, ARRAY['asset-allocation', 'portfolio', 'strategy'], 1, TRUE, 'published', ARRAY['B12']),
('IC2', 'intermediate', 'IC', 'Factor Investing: Value, Growth, Momentum', 'Introduction to factor-based investing and style tilts in portfolio construction.', 'Understand factor investing, implement style tilts, and evaluate factor exposure.', 35, ARRAY['factor-investing', 'value', 'growth'], 2, TRUE, 'published', ARRAY['IC1']),
('IC3', 'intermediate', 'IC', 'Rebalancing & Portfolio Maintenance', 'When and how to rebalance portfolios to maintain target allocations.', 'Develop a rebalancing strategy and execute portfolio maintenance effectively.', 25, ARRAY['rebalancing', 'portfolio-maintenance', 'practical'], 3, TRUE, 'published', ARRAY['IC1']),
('IC4', 'intermediate', 'IC', 'Understanding Alternatives', 'Introduction to alternative investments: REITs, commodities, private equity, hedge funds.', 'Evaluate alternative investments and understand their role in portfolio diversification.', 30, ARRAY['alternatives', 'reits', 'diversification'], 4, TRUE, 'published', ARRAY['IC1']),
('IC5', 'intermediate', 'IC', 'ESG & Sustainable Investing', 'Environmental, social, and governance factors in investment decision-making.', 'Integrate ESG considerations into investment analysis and portfolio construction.', 30, ARRAY['esg', 'sustainable', 'impact'], 5, TRUE, 'published', ARRAY['IC1']),
('IC6', 'intermediate', 'IC', 'Derivatives Basics: Hedging & Speculation', 'Introduction to options, futures, and other derivatives for hedging and risk management.', 'Understand derivative instruments and use them for hedging portfolio risk.', 35, ARRAY['derivatives', 'options', 'hedging'], 6, TRUE, 'published', ARRAY['IC1'])
ON CONFLICT (module_code) DO UPDATE SET
    title = EXCLUDED.title,
    summary = EXCLUDED.summary,
    learning_objective = EXCLUDED.learning_objective,
    updated_at = NOW();

-- ============================================================
-- INTERMEDIATE MODULES - Track ID (6)
-- ============================================================

INSERT INTO public.education_bank (module_code, level, track_or_pathway, title, summary, learning_objective, estimated_minutes, tags, display_order, is_active, status, prerequisites) VALUES
('ID1', 'intermediate', 'ID', 'Goal-Based Financial Planning', 'Align investments with specific financial goals: retirement, education, major purchases.', 'Create goal-based investment plans and track progress toward specific objectives.', 30, ARRAY['financial-planning', 'goals', 'planning'], 1, TRUE, 'published', ARRAY['B12']),
('ID2', 'intermediate', 'ID', 'Retirement Planning Essentials', 'Calculate retirement needs, understand 401(k)s, IRAs, and retirement savings strategies.', 'Build a comprehensive retirement plan with appropriate savings and investment strategies.', 35, ARRAY['retirement', '401k', 'ira'], 2, TRUE, 'published', ARRAY['ID1']),
('ID3', 'intermediate', 'ID', 'Risk Management & Insurance', 'Protect your wealth with appropriate insurance and risk management strategies.', 'Evaluate insurance needs and implement risk management strategies for financial security.', 30, ARRAY['insurance', 'risk-management', 'protection'], 3, TRUE, 'published', ARRAY['ID1']),
('ID4', 'intermediate', 'ID', 'Tax-Aware Investing', 'Minimize taxes through tax-efficient investment strategies and account selection.', 'Implement tax-loss harvesting, asset location, and other tax optimization strategies.', 30, ARRAY['taxes', 'tax-efficient', 'optimization'], 4, TRUE, 'published', ARRAY['ID1']),
('ID5', 'intermediate', 'ID', 'Estate Planning Basics', 'Introduction to estate planning: wills, trusts, and wealth transfer strategies.', 'Understand estate planning fundamentals and create a basic estate plan.', 30, ARRAY['estate-planning', 'wills', 'trusts'], 5, TRUE, 'published', ARRAY['ID1']),
('ID6', 'intermediate', 'ID', 'Behavioral Finance: Helping Clients Stick to the Plan', 'Understand cognitive biases and emotional pitfalls that derail investment success.', 'Recognize behavioral biases and develop strategies to overcome them.', 30, ARRAY['behavioral-finance', 'psychology', 'biases'], 6, TRUE, 'published', ARRAY['ID1'])
ON CONFLICT (module_code) DO UPDATE SET
    title = EXCLUDED.title,
    summary = EXCLUDED.summary,
    learning_objective = EXCLUDED.learning_objective,
    updated_at = NOW();

-- ============================================================
-- ADVANCED MODULES - Pathway A1 (10)
-- ============================================================

INSERT INTO public.education_bank (module_code, level, track_or_pathway, title, summary, learning_objective, estimated_minutes, tags, display_order, is_active, status, prerequisites) VALUES
('A1.1', 'advanced', 'A1', 'Advanced Financial Statement Analysis & Forensics', 'Detect accounting manipulation, analyze cash flow quality, and identify red flags.', 'Perform forensic accounting analysis and identify financial statement manipulation.', 50, ARRAY['forensic-accounting', 'analysis', 'advanced'], 1, TRUE, 'published', ARRAY['IB3']),
('A1.2', 'advanced', 'A1', 'Building a 3-Statement Model from Scratch', 'Build a fully integrated 3-statement financial model linking income statement, balance sheet, and cash flow.', 'Create a professional 3-statement model with proper linkages and assumptions.', 60, ARRAY['modeling', '3-statement', 'excel'], 2, TRUE, 'published', ARRAY['IA6', 'IB3']),
('A1.3', 'advanced', 'A1', 'Comprehensive DCF: Scenarios, Sensitivities, Terminal Value', 'Build advanced DCF models with multiple scenarios, sensitivity analysis, and terminal value calculations.', 'Construct sophisticated DCF models with scenario analysis and sensitivity tables.', 60, ARRAY['dcf', 'valuation', 'scenarios'], 3, TRUE, 'published', ARRAY['IB5', 'A1.2']),
('A1.4', 'advanced', 'A1', 'Relative Valuation Mastery: Peer Comps & Trading Comps', 'Master relative valuation using comparable companies and precedent transactions.', 'Perform comprehensive relative valuation analysis using multiple methodologies.', 50, ARRAY['valuation', 'comps', 'relative'], 4, TRUE, 'published', ARRAY['IB4']),
('A1.5', 'advanced', 'A1', 'Sector Analysis: Tech, Healthcare, Financials, Industrials', 'Deep sector-specific analysis: key metrics, drivers, and valuation approaches for major sectors.', 'Analyze companies within sector context and apply sector-specific valuation methods.', 55, ARRAY['sector-analysis', 'industry', 'specialization'], 5, TRUE, 'published', ARRAY['A1.4']),
('A1.6', 'advanced', 'A1', 'Credit Analysis: Leverage, Coverage, Covenants, Recovery', 'Analyze credit risk, debt capacity, and recovery prospects for fixed income investments.', 'Perform comprehensive credit analysis and assess default risk.', 50, ARRAY['credit-analysis', 'bonds', 'risk'], 6, TRUE, 'published', ARRAY['IB6']),
('A1.7', 'advanced', 'A1', 'Writing Investment Research: Structure, Thesis, Risk Factors', 'Learn to write professional investment research reports with clear thesis and risk analysis.', 'Write compelling investment research reports that communicate analysis effectively.', 45, ARRAY['research', 'writing', 'communication'], 7, TRUE, 'published', ARRAY['A1.3']),
('A1.8', 'advanced', 'A1', 'Pitching Ideas: Presenting to Investment Committees', 'Master the art of presenting investment ideas to committees and decision-makers.', 'Deliver persuasive investment pitches with clear rationale and risk assessment.', 40, ARRAY['presentation', 'pitching', 'communication'], 8, TRUE, 'published', ARRAY['A1.7']),
('A1.9', 'advanced', 'A1', 'Thematic Investing: Identifying Long-Term Trends', 'Identify and invest in long-term thematic trends: demographics, technology, sustainability.', 'Develop thematic investment strategies based on structural trends.', 45, ARRAY['thematic', 'trends', 'strategy'], 9, TRUE, 'published', ARRAY['A1.5']),
('A1.10', 'advanced', 'A1', 'Case Study: Full Equity Research Report (Capstone)', 'Complete a full equity research report from analysis to recommendation as a capstone project.', 'Synthesize all equity research skills into a comprehensive research report.', 90, ARRAY['capstone', 'case-study', 'research'], 10, TRUE, 'published', ARRAY['A1.8', 'A1.9'])
ON CONFLICT (module_code) DO UPDATE SET
    title = EXCLUDED.title,
    summary = EXCLUDED.summary,
    learning_objective = EXCLUDED.learning_objective,
    updated_at = NOW();

-- ============================================================
-- ADVANCED MODULES - Pathway A2 (10)
-- ============================================================

INSERT INTO public.education_bank (module_code, level, track_or_pathway, title, summary, learning_objective, estimated_minutes, tags, display_order, is_active, status, prerequisites) VALUES
('A2.1', 'advanced', 'A2', 'Advanced Portfolio Theory: CAPM, Multifactor Models', 'Deep dive into modern portfolio theory, CAPM, and multifactor asset pricing models.', 'Apply advanced portfolio theory and factor models to portfolio construction.', 55, ARRAY['portfolio-theory', 'capm', 'factors'], 1, TRUE, 'published', ARRAY['IA5']),
('A2.2', 'advanced', 'A2', 'Strategic vs. Tactical Asset Allocation', 'Compare strategic and tactical allocation approaches and when to use each.', 'Implement both strategic and tactical allocation strategies effectively.', 50, ARRAY['asset-allocation', 'strategy', 'tactical'], 2, TRUE, 'published', ARRAY['IC1', 'A2.1']),
('A2.3', 'advanced', 'A2', 'Risk Budgeting & Risk Parity', 'Allocate risk rather than capital: risk budgeting and risk parity portfolio construction.', 'Build risk-parity portfolios and implement risk budgeting frameworks.', 55, ARRAY['risk-parity', 'risk-budgeting', 'advanced'], 3, TRUE, 'published', ARRAY['A2.1']),
('A2.4', 'advanced', 'A2', 'Performance Measurement: TWRR, MWRR, Attribution', 'Measure portfolio performance using time-weighted and money-weighted returns, plus attribution analysis.', 'Calculate and interpret performance metrics and attribution analysis.', 50, ARRAY['performance', 'attribution', 'measurement'], 4, TRUE, 'published', ARRAY['IA3']),
('A2.5', 'advanced', 'A2', 'Manager Selection & Due Diligence', 'Evaluate and select investment managers using quantitative and qualitative analysis.', 'Perform comprehensive manager due diligence and selection.', 50, ARRAY['manager-selection', 'due-diligence', 'evaluation'], 5, TRUE, 'published', ARRAY['A2.4']),
('A2.6', 'advanced', 'A2', 'Currency & Global Risk Management', 'Manage currency risk in global portfolios and implement hedging strategies.', 'Implement currency hedging strategies for international portfolios.', 50, ARRAY['currency', 'hedging', 'global'], 6, TRUE, 'published', ARRAY['IC6']),
('A2.7', 'advanced', 'A2', 'Liability-Driven Investing (LDI) for Institutions', 'Design portfolios to match institutional liabilities: pension funds, insurance companies.', 'Build LDI strategies for institutional investors with defined liabilities.', 55, ARRAY['ldi', 'institutional', 'liabilities'], 7, TRUE, 'published', ARRAY['A2.3']),
('A2.8', 'advanced', 'A2', 'Advanced Fixed Income: Duration Hedging, Credit Portfolios', 'Advanced bond portfolio management: duration matching, credit analysis, and yield curve strategies.', 'Manage complex fixed income portfolios with advanced strategies.', 55, ARRAY['fixed-income', 'duration', 'credit'], 8, TRUE, 'published', ARRAY['IB6', 'A1.6']),
('A2.9', 'advanced', 'A2', 'Systematic & Factor-Based Strategies', 'Design and implement systematic investment strategies using factor models.', 'Build and backtest systematic factor-based investment strategies.', 60, ARRAY['systematic', 'factors', 'quantitative'], 9, TRUE, 'published', ARRAY['A2.1', 'IC2']),
('A2.10', 'advanced', 'A2', 'Case Study: Build a Multi-Asset Portfolio for a Pension Fund', 'Capstone: Design a complete multi-asset portfolio strategy for an institutional client.', 'Synthesize portfolio management skills into a comprehensive institutional strategy.', 90, ARRAY['capstone', 'case-study', 'institutional'], 10, TRUE, 'published', ARRAY['A2.7', 'A2.9'])
ON CONFLICT (module_code) DO UPDATE SET
    title = EXCLUDED.title,
    summary = EXCLUDED.summary,
    learning_objective = EXCLUDED.learning_objective,
    updated_at = NOW();

-- ============================================================
-- ADVANCED MODULES - Pathway A3 (10)
-- ============================================================

INSERT INTO public.education_bank (module_code, level, track_or_pathway, title, summary, learning_objective, estimated_minutes, tags, display_order, is_active, status, prerequisites) VALUES
('A3.1', 'advanced', 'A3', 'Comprehensive Financial Planning: Integrating All Domains', 'Integrate investment, tax, estate, insurance, and retirement planning into comprehensive plans.', 'Create holistic financial plans that integrate all planning domains.', 60, ARRAY['financial-planning', 'comprehensive', 'integration'], 1, TRUE, 'published', ARRAY['ID1']),
('A3.2', 'advanced', 'A3', 'Advanced Retirement & Decumulation Strategies', 'Optimize retirement withdrawal strategies, sequence of returns risk, and decumulation planning.', 'Design optimal retirement withdrawal strategies for various scenarios.', 55, ARRAY['retirement', 'decumulation', 'withdrawals'], 2, TRUE, 'published', ARRAY['ID2', 'A3.1']),
('A3.3', 'advanced', 'A3', 'Tax Optimization: Withdrawal Sequencing, Roth Conversions', 'Advanced tax strategies: optimal withdrawal sequencing and Roth conversion planning.', 'Implement sophisticated tax optimization strategies for retirement.', 50, ARRAY['taxes', 'roth', 'optimization'], 3, TRUE, 'published', ARRAY['ID4', 'A3.2']),
('A3.4', 'advanced', 'A3', 'Estate Planning: Trusts, Gifting, Charitable Strategies', 'Advanced estate planning: complex trust structures, gifting strategies, and charitable giving.', 'Design comprehensive estate plans using advanced techniques.', 55, ARRAY['estate-planning', 'trusts', 'charitable'], 4, TRUE, 'published', ARRAY['ID5', 'A3.1']),
('A3.5', 'advanced', 'A3', 'Managing High-Net-Worth Clients: Family Dynamics, Governance', 'Specialized strategies for HNW clients: family governance, multi-generational planning.', 'Manage complex HNW client relationships and family dynamics.', 50, ARRAY['hnw', 'family', 'governance'], 5, TRUE, 'published', ARRAY['A3.1']),
('A3.6', 'advanced', 'A3', 'Behavioral Coaching: Keeping Clients Disciplined in Volatility', 'Advanced behavioral finance: coaching clients through market volatility and emotional decisions.', 'Apply behavioral finance principles to client coaching and relationship management.', 45, ARRAY['behavioral', 'coaching', 'client-management'], 6, TRUE, 'published', ARRAY['ID6', 'A3.1']),
('A3.7', 'advanced', 'A3', 'Insurance Strategies for HNW Families', 'Advanced insurance planning: life, disability, liability, and specialized coverage for HNW families.', 'Design comprehensive insurance strategies for high-net-worth families.', 50, ARRAY['insurance', 'hnw', 'risk-management'], 7, TRUE, 'published', ARRAY['ID3', 'A3.5']),
('A3.8', 'advanced', 'A3', 'Business Owner Planning: Succession, Exit, Liquidity', 'Financial planning for business owners: succession planning, exit strategies, and liquidity events.', 'Create comprehensive financial plans for business owners.', 55, ARRAY['business-owners', 'succession', 'exit'], 8, TRUE, 'published', ARRAY['A3.1']),
('A3.9', 'advanced', 'A3', 'Practice Management: Service Models, Fee Structures, CRM', 'Build and manage a financial advisory practice: service models, pricing, and client management.', 'Design and implement effective practice management systems.', 50, ARRAY['practice-management', 'crm', 'business'], 9, TRUE, 'published', ARRAY['A3.1']),
('A3.10', 'advanced', 'A3', 'Case Study: Full Financial Plan for Complex Household', 'Capstone: Create a comprehensive financial plan for a complex high-net-worth household.', 'Synthesize all financial planning skills into a comprehensive client plan.', 90, ARRAY['capstone', 'case-study', 'financial-planning'], 10, TRUE, 'published', ARRAY['A3.8', 'A3.9'])
ON CONFLICT (module_code) DO UPDATE SET
    title = EXCLUDED.title,
    summary = EXCLUDED.summary,
    learning_objective = EXCLUDED.learning_objective,
    updated_at = NOW();

-- ============================================================
-- ADVANCED MODULES - Pathway A4 (10)
-- ============================================================

INSERT INTO public.education_bank (module_code, level, track_or_pathway, title, summary, learning_objective, estimated_minutes, tags, display_order, is_active, status, prerequisites) VALUES
('A4.1', 'advanced', 'A4', 'PE/VC Fund Structures: LP/GP, Carry, Waterfalls', 'Understand private equity and venture capital fund structures, economics, and terms.', 'Analyze PE/VC fund structures and evaluate fund economics.', 50, ARRAY['pe', 'vc', 'fund-structures'], 1, TRUE, 'published', ARRAY['B8']),
('A4.2', 'advanced', 'A4', 'Deal Sourcing & Screening: Building a Pipeline', 'Develop systematic approaches to sourcing and screening investment opportunities.', 'Build and manage a deal pipeline for private investments.', 45, ARRAY['deal-sourcing', 'screening', 'pipeline'], 2, TRUE, 'published', ARRAY['A4.1']),
('A4.3', 'advanced', 'A4', 'Commercial Due Diligence: Market, Competitive Moat, TAM', 'Perform commercial due diligence: market analysis, competitive positioning, and TAM assessment.', 'Conduct comprehensive commercial due diligence on investment opportunities.', 55, ARRAY['due-diligence', 'market-analysis', 'competitive'], 3, TRUE, 'published', ARRAY['A4.2']),
('A4.4', 'advanced', 'A4', 'Financial Due Diligence & Quality of Earnings', 'Analyze financial due diligence reports, quality of earnings, and working capital requirements.', 'Perform financial due diligence and assess earnings quality.', 55, ARRAY['due-diligence', 'financial', 'earnings'], 4, TRUE, 'published', ARRAY['A1.1', 'A4.3']),
('A4.5', 'advanced', 'A4', 'Building an LBO Model (Leveraged Buyout)', 'Build comprehensive LBO models: sources and uses, returns analysis, and sensitivity testing.', 'Create professional LBO models for private equity transactions.', 70, ARRAY['lbo', 'modeling', 'private-equity'], 5, TRUE, 'published', ARRAY['A1.2', 'A4.4']),
('A4.6', 'advanced', 'A4', 'Venture Cap Table Modeling & Term Sheets', 'Model venture capital cap tables, dilution, and analyze term sheet economics.', 'Build cap table models and analyze VC term sheet terms.', 60, ARRAY['vc', 'cap-table', 'term-sheet'], 6, TRUE, 'published', ARRAY['A4.1']),
('A4.7', 'advanced', 'A4', 'Value Creation: Operational Improvements, Roll-Ups', 'Develop value creation plans: operational improvements, add-on acquisitions, and roll-up strategies.', 'Design and implement value creation strategies for portfolio companies.', 55, ARRAY['value-creation', 'operations', 'roll-ups'], 7, TRUE, 'published', ARRAY['A4.5']),
('A4.8', 'advanced', 'A4', 'Board Governance & Management Incentives', 'Design effective board structures and management incentive plans for portfolio companies.', 'Implement governance and incentive structures that drive value creation.', 50, ARRAY['governance', 'incentives', 'management'], 8, TRUE, 'published', ARRAY['A4.7']),
('A4.9', 'advanced', 'A4', 'Exit Strategies: IPO, Trade Sale, Secondary', 'Evaluate and execute exit strategies: IPO preparation, trade sales, and secondary transactions.', 'Plan and execute successful exits for private investments.', 55, ARRAY['exits', 'ipo', 'm&a'], 9, TRUE, 'published', ARRAY['A4.7']),
('A4.10', 'advanced', 'A4', 'Case Study: Full Deal Analysis from Screening to Exit', 'Capstone: Complete a full private equity deal analysis from initial screening through exit.', 'Synthesize all PE/VC skills into a comprehensive deal analysis.', 90, ARRAY['capstone', 'case-study', 'private-equity'], 10, TRUE, 'published', ARRAY['A4.8', 'A4.9'])
ON CONFLICT (module_code) DO UPDATE SET
    title = EXCLUDED.title,
    summary = EXCLUDED.summary,
    learning_objective = EXCLUDED.learning_objective,
    updated_at = NOW();

-- ============================================================
-- ADVANCED MODULES - Pathway A5 (10)
-- ============================================================

INSERT INTO public.education_bank (module_code, level, track_or_pathway, title, summary, learning_objective, estimated_minutes, tags, display_order, is_active, status, prerequisites) VALUES
('A5.1', 'advanced', 'A5', 'Advanced Risk Metrics: VaR, CVaR, Tail Risk', 'Calculate and interpret Value at Risk, Conditional VaR, and tail risk measures.', 'Implement advanced risk metrics for portfolio risk management.', 55, ARRAY['risk', 'var', 'tail-risk'], 1, TRUE, 'published', ARRAY['IA2']),
('A5.2', 'advanced', 'A5', 'Stress Testing & Scenario Analysis', 'Design and implement stress tests and scenario analysis for portfolios.', 'Build comprehensive stress testing frameworks for risk management.', 60, ARRAY['stress-testing', 'scenarios', 'risk'], 2, TRUE, 'published', ARRAY['A5.1']),
('A5.3', 'advanced', 'A5', 'Factor Models & Risk Decomposition', 'Decompose portfolio risk using factor models and identify risk sources.', 'Analyze portfolio risk using factor models and risk decomposition.', 55, ARRAY['factor-models', 'risk-decomposition', 'quantitative'], 3, TRUE, 'published', ARRAY['A2.1', 'A5.1']),
('A5.4', 'advanced', 'A5', 'Portfolio Optimization: Mean-Variance, Black-Litterman', 'Implement portfolio optimization using mean-variance and Black-Litterman models.', 'Build optimized portfolios using advanced optimization techniques.', 60, ARRAY['optimization', 'mean-variance', 'black-litterman'], 4, TRUE, 'published', ARRAY['A5.3']),
('A5.5', 'advanced', 'A5', 'Derivatives Pricing & Hedging: Options, Swaps', 'Price derivatives and design hedging strategies using options and swaps.', 'Price derivatives and implement hedging strategies.', 65, ARRAY['derivatives', 'pricing', 'hedging'], 5, TRUE, 'published', ARRAY['IC6']),
('A5.6', 'advanced', 'A5', 'Backtesting & Performance Attribution', 'Backtest investment strategies and perform detailed performance attribution analysis.', 'Backtest strategies and analyze performance attribution.', 60, ARRAY['backtesting', 'attribution', 'performance'], 6, TRUE, 'published', ARRAY['A2.4', 'A5.4']),
('A5.7', 'advanced', 'A5', 'Data Science for Finance: Python, Pandas, Quant Libraries', 'Use Python and quantitative libraries for financial analysis and modeling.', 'Build financial models and analysis tools using Python.', 70, ARRAY['python', 'data-science', 'quantitative'], 7, TRUE, 'published', ARRAY['IA6']),
('A5.8', 'advanced', 'A5', 'Building Systematic Trading Strategies', 'Design and implement systematic trading strategies with proper risk management.', 'Build and deploy systematic trading strategies.', 65, ARRAY['systematic', 'trading', 'strategies'], 8, TRUE, 'published', ARRAY['A5.6', 'A5.7']),
('A5.9', 'advanced', 'A5', 'Machine Learning in Portfolio Management (Intro)', 'Introduction to machine learning applications in portfolio management and trading.', 'Apply machine learning techniques to portfolio management.', 70, ARRAY['machine-learning', 'ai', 'quantitative'], 9, TRUE, 'published', ARRAY['A5.7']),
('A5.10', 'advanced', 'A5', 'Case Study: Build and Backtest a Factor-Based Strategy', 'Capstone: Design, implement, and backtest a complete factor-based investment strategy.', 'Synthesize quantitative skills into a complete investment strategy.', 90, ARRAY['capstone', 'case-study', 'quantitative'], 10, TRUE, 'published', ARRAY['A5.8', 'A5.9'])
ON CONFLICT (module_code) DO UPDATE SET
    title = EXCLUDED.title,
    summary = EXCLUDED.summary,
    learning_objective = EXCLUDED.learning_objective,
    updated_at = NOW();

-- ============================================================
-- SAMPLE QUESTIONS (Template - Generate 3+ per module)
-- ============================================================
-- Note: This is a template. Generate 3-5 questions per module.
-- Below are sample questions for B1 as an example.

-- Questions for B1: What Does Finance Actually Do?
INSERT INTO public.education_questions (module_code, question_text, question_type, options, correct_answer, explanation, points, display_order, is_active) VALUES
('B1', 'What is the primary purpose of finance?', 'multiple_choice', 
 '{"A": "To make money quickly", "B": "To allocate resources efficiently over time", "C": "To predict market movements", "D": "To avoid paying taxes"}'::jsonb,
 'B', 
 'Finance is fundamentally about allocating resources efficiently over time, balancing present and future needs.',
 1, 1, TRUE),
('B1', 'Finance only applies to large corporations and banks.', 'true_false',
 NULL,
 'false',
 'Finance applies to individuals, businesses, governments, and organizations of all sizes. Personal finance is just as important as corporate finance.',
 1, 2, TRUE),
('B1', 'Which of the following is NOT a core function of finance?', 'multiple_choice',
 '{"A": "Investment decisions", "B": "Financing decisions", "C": "Dividend decisions", "D": "Weather forecasting"}'::jsonb,
 'D',
 'Weather forecasting is not a finance function. The three core functions are investment (where to invest), financing (how to fund investments), and dividend (how to distribute profits).',
 1, 3, TRUE)
ON CONFLICT DO NOTHING;

-- ============================================================
-- Question Generator Template
-- ============================================================
-- Use this template to generate questions for remaining modules
-- Minimum 3 questions per module, mix of types

/*
INSERT INTO public.education_questions (module_code, question_text, question_type, options, correct_answer, explanation, points, display_order, is_active) VALUES
('MODULE_CODE', 'Question text here?', 'multiple_choice', 
 '{"A": "Option A", "B": "Option B", "C": "Option C", "D": "Option D"}'::jsonb,
 'CORRECT_ANSWER', 
 'Explanation of why this answer is correct and what the concept means.',
 1, ORDER_NUM, TRUE),
('MODULE_CODE', 'True or false statement here.', 'true_false',
 NULL,
 'true_or_false',
 'Explanation of the correct answer.',
 1, ORDER_NUM, TRUE);
*/

-- ============================================================
-- Seed Complete
-- ============================================================

SELECT '✅ Curriculum seed data complete! 86 modules loaded.' as status;
SELECT COUNT(*) as total_modules FROM public.education_bank;
SELECT COUNT(*) as total_questions FROM public.education_questions;

# Resolve the dated scenario once, then export identical game rows for pricing and production.
args <- commandArgs(trailingOnly=TRUE)
if(length(args)!=7L) stop("Expected repo, healthy CSV, player JSON, schedule JSON, injury JSON, as-of date, output CSV")
source(file.path(args[1],"script/frontend/live_minutes.R"))
source(file.path(args[1],"script/frontend/injury_projections.R"))
roles <- read.csv(args[2],stringsAsFactors=FALSE)
players <- jsonlite::fromJSON(args[3])
players <- players[players$pool_status=="roster",]
players$id <- ifelse(is.na(players$source_nba_id),players$nba_id,players$source_nba_id)
schedule <- jsonlite::fromJSON(args[4])
outlook <- jsonlite::fromJSON(args[5],simplifyVector=FALSE)
asof <- as.Date(args[6])
if(any(roles$asof!=args[6]) || substr(outlook$generated_at,1,10)!=args[6]) stop("Mixed observation dates")
calendar <- injury_projection_calendar(schedule,outlook$season)
keys <- vapply(outlook$players,function(r) paste(r$team,r$name_key),character(1))
if(anyDuplicated(keys) || anyDuplicated(players$id) || anyDuplicated(roles[c("nba_id","game")])) stop("Duplicate forecast identity")
if(!setequal(players$id,roles$nba_id)) stop("Incomplete player forecast")
roles$expected_minutes <- roles$probability*roles$conditional_mpg
roles$baseline_minutes <- roles$expected_minutes
roles$baseline_probability <- roles$probability
roles$healthy_rotation <- roles$direct_minutes <- roles$availability <- NA_real_
roles$team_game_clock <- NA_integer_
for(team in unique(roles$team)) {
  roster <- players[players$team==team,]
  team_calendar <- calendar[calendar$team==team,]
  dates <- sort(as.Date(team_calendar$date[!team_calendar$completed & as.Date(team_calendar$date)>=asof]))
  if(any(roster$minutes_remaining_team_games!=length(dates))) stop("Team clock disagrees with schedule: ",team)
  injury <- match(paste(team,injury_name_key(roster$player_name)),keys)
  plans <- lapply(injury,function(k) if(is.na(k)) NULL else injury_projection_plan(outlook$players[[k]],asof,team_calendar))
  offsets <- which(roles$team==team)
  groups <- split(offsets,roles$game[offsets])
  carry <- numeric(nrow(roster))
  for(game in seq_along(groups)) {
    idx <- groups[[as.character(game)]]
    idx <- idx[match(roster$id,roles$nba_id[idx])]
    if(anyNA(idx)) stop("Missing player game")
    prob <- roles$probability[idx]
    base <- roles$expected_minutes[idx]
    if(game<=length(dates)) {
      roster$minutes_play_probability <- prob
      roster$minutes_expected_mpg <- balance_live_minutes(base, 38*prob)
      roster$minutes_healthy_mpg <- ifelse(prob>0,roster$minutes_expected_mpg/prob,0)
      factor <- vapply(plans,injury_availability_on_date,numeric(1),date=dates[game])
      healthy <- allocate_live_rotation(roster, rep(1, nrow(roster)))$minutes/82
      rotation <- allocate_live_rotation(roster,factor)
      mins <- rotation$minutes/82
      prob <- rotation$games/82
      if(abs(sum(mins)-min(240,sum(48*prob)))>1e-7) stop("Unexplained team minute shortfall")
      carry <- roster$minutes_expected_mpg-base
    } else {
      # Future roster spots are uncertain. Fade the last healthy roster adjustment;
      # retain expected minutes for incoming or currently unidentified players.
      mins <- pmin(48*prob,pmax(0,base+carry*2^(-(game-length(dates))/41)))
      if(sum(mins)>240) mins <- mins*(240/sum(mins))
      healthy <- mins
      factor <- rep(1, nrow(roster))
    }
    roles$healthy_rotation[idx] <- healthy
    roles$availability[idx] <- factor
    roles$direct_minutes[idx] <- healthy*factor
    roles$team_game_clock[idx] <- 82L*(outlook$season-2000L) + 82L-length(dates) + game-1L
    roles$probability[idx] <- prob
    roles$expected_minutes[idx] <- mins
    roles$conditional_mpg[idx] <- ifelse(prob>0,mins/prob,0)
  }
}
if(any(!is.finite(roles$expected_minutes)) || any(abs(roles$expected_minutes-roles$probability*roles$conditional_mpg)>1e-7)) stop("Invalid final forecast")
if(file.exists(args[7])) stop("Output already exists")
write.csv(roles,args[7],row.names=FALSE)
